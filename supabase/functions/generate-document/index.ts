// Edge Function: generate-document
// Gera um documento (Termo de Vistoria, Certificado de Entrega, Declaração MCMV, Requerimento
// de Averbação) preenchido com dados extraídos dos documentos-fonte anexados (contrato, matrícula,
// alvará etc). Usa como referência de estilo os modelos reais da empresa (embutidos abaixo) —
// a IA reproduz a estrutura/formatação/tom desses modelos, mas com os dados encontrados nos
// documentos-fonte. Quando não encontra um dado, marca com [NÃO ENCONTRADO — PREENCHER MANUALMENTE]
// em vez de inventar.
//
// Entrada: { docType, sources } — docType é uma das chaves de DOC_TEMPLATES, sources é um ARRAY
// de 1+ documentos-fonte, cada um no formato:
//   { documentId }                                  -> documento já arquivado (lê do Storage)
//   { fileBase64, fileName, mimeType }               -> arquivo anexado só pra esta geração
//
// Deploy: supabase functions deploy generate-document
// Precisa do secret ANTHROPIC_API_KEY (mesmo usado por analyze-document).
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já vêm prontos no ambiente da função.

import { createClient } from "npm:@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function extToMediaType(ext: string): string {
  ext = ext.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "";
}

async function prepareDoc(spec: any, supabase: any, label: string) {
  let base64: string, mediaType: string, name: string;

  if (spec.documentId) {
    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .select("id, name, file_path, file_type")
      .eq("id", spec.documentId)
      .single();
    if (docErr || !doc) throw new Error("Documento " + label + " não encontrado");
    if (!doc.file_path) throw new Error("Documento " + label + " não tem arquivo anexado");

    const { data: signed, error: signErr } = await supabase.storage
      .from("documentos")
      .createSignedUrl(doc.file_path, 120);
    if (signErr || !signed) throw new Error("Não foi possível abrir o documento " + label);

    const fileRes = await fetch(signed.signedUrl);
    if (!fileRes.ok) throw new Error("Falha ao baixar o documento " + label);
    const buf = new Uint8Array(await fileRes.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    base64 = btoa(binary);
    mediaType = extToMediaType((doc.file_type || doc.name.split(".").pop() || "").toLowerCase());
    name = doc.name;
  } else if (spec.fileBase64) {
    base64 = spec.fileBase64;
    mediaType = spec.mimeType || extToMediaType((spec.fileName || "").split(".").pop() || "");
    name = spec.fileName || "arquivo";
  } else {
    throw new Error("Documento " + label + " inválido");
  }

  if (!mediaType) throw new Error("Documento " + label + " precisa ser PDF ou imagem (jpg/png/webp)");

  const block = mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: mediaType, data: base64 } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };

  return { name, block };
}

// Modelos reais da empresa — usados como referência de estrutura/estilo/formatação.
// A IA deve seguir esse formato à risca, só trocando os dados pelos encontrados nos documentos-fonte.
const DOC_TEMPLATES: Record<string, { label: string; template: string; guidance: string }> = {
  termo_vistoria: {
    label: "Termo de Vistoria e Entrega do Imóvel",
    template: `TERMO DE VISTORIA E ENTREGA DE IMÓVEL
VENDEDOR: Nome: PEDRO BATISTA TORRES ME CPF/CNPJ: 11.377.201/0001-29
COMPRADOR: Nome: GIOVANE CATARINO PINHEIRO
CPF/CNPJ: 123.760.914-38

IMÓVEL: Endereço: RUA CEARA, N 44 01, CASA 01
,, LOTE 294, QUADRA 18, LOTEAMENTO CENTRAL PARQUE CLUBE, ESTIVAS , EXTREMOZ- RN.
1. OBJETO
Este Termo tem por objeto registrar a vistoria e entrega do imóvel acima identificado, nas condições descritas abaixo.
2. CONDIÇÕES DO IMÓVEL

- PINTURA: ( ) Bom   ( ) Com avarias

- INSTALAÇÕES ELÉTRICAS: ( ) Funcionando  ( ) Com problemas [especificar]
_______________________________________________________________________________
_______________________________________________________________________________
- INSTALAÇÕES HIDRÁULICAS: ( ) Funcionando  ( ) Com problemas [especificar]
_______________________________________________________________________________
_______________________________________________________________________________
- PORTAS E JANELAS: ( ) Funcionando  ( ) Danificadas [especificar]
_______________________________________________________________________________
_______________________________________________________________________________
- PISOS E REVESTIMENTOS: ( ) Em bom estado  ( ) Com avarias [especificar]
_______________________________________________________________________________
_______________________________________________________________________________

- OBSERVAÇÕES ADICIONAIS: [Espaço livre para anotações sobre o estado do imóvel]
_______________________________________________________________________________
_______________________________________________________________________________

3. DECLARAÇÃO
As partes declaram que o imóvel foi entregue/vistoriado na data supracitada, conforme condições acima, não havendo pendências a serem resolvidas até o momento.
4. ASSINATURAS
Por estarem de acordo, assinam o presente Termo em duas vias de igual teor.

_________________________________________ VENDEDOR

_________________________________________
COMPRADOR


DATA DA ENTREGA:`,
    guidance: "Preencha VENDEDOR (quem construiu/vendeu — procure nos documentos-fonte, ex: contrato, matrícula) e COMPRADOR (nome e CPF/CNPJ) e o endereço completo do imóvel (rua, número, casa, lote, quadra, loteamento, bairro, cidade/UF). Mantenha os campos de vistoria (pintura, instalações etc.) em branco com as opções ( ) exatamente como no modelo — são preenchidos manualmente na vistoria presencial, não pela IA. Deixe a linha de data em branco também."
  },
  certificado_entrega: {
    label: "Certificado de Entrega",
    template: `CERTIFICADO DE ENTREGA

Eu, JOSE ERIVAN DE OLIVEIRA JUNIOR , CPF: 088.278.604-01 certifico que recebi e li o guia do proprietário, os termos de garantias, assim como as chaves do imóvel, juntamente com o contrato do imóvel registrado, referente ao imóvel localizado A UNIDADE RESIDENCIAL SITUADA A AVENIDA BOM JESUS, N°226-03, CASA 03, LOTE 14, QUADRA 03, LOTEAMENTO PARQUE DAS FRUTEIRAS, SITUADO NO MUNICÍPIO DE EXTREMOZ/RN - CEP: 59575-000.



                                                                                  ______ de _________________ de 2026.







____________________________________________________________________

 (  JOSE ERIVAN DE OLIVEIRA JUNIOR  )
CPF:088.278.604-01`,
    guidance: "Preencha o nome completo e CPF do comprador/morador, e a descrição completa do imóvel (tipo de unidade, endereço, número, casa, lote, quadra, loteamento, município/UF, CEP) a partir dos documentos-fonte. Deixe a linha de data (______ de _________________ de 2026) em branco para preenchimento manual no momento da assinatura."
  },
  declaracao_mcmv: {
    label: "Declaração de Desconto MCMV",
    template: `DECLARAÇÃO DE ENQUADRAMENTO DO PROGRAMA MINHA CASA, MINHA VIDA (PMCMV), Art. 42, II, da Lei nº 11.977/2009.

DECLARANTE: NOVO PLANO INCORPORAÇÃO IMOBILIÁRIA LTDA, inscrita no CNPJ/MF sob o nº 61.041.452/0001-06, com endereço na Rua Rio Tocantins, nº S/N, Lot. Jardim dos Pampas, Centro, Extremoz/RN, representada conforme contrato social, por JEFFERSON ARAUJO DE BRITO, brasileiro, nascido em 18/05/2002, portador da CNH nº08155120047 – DETRAN-RN, e CPF nº 700.495.424-27.  Para os devidos fins junto ao Cartório de Registro de Imóveis de Extremoz/RN, declara que o imóvel abaixo descrito se enquadra no Programa Minha Casa, Minha Vida (PMCMV), atendendo às faixas 1 e 2 do programa, que contempla famílias com renda familiar de até R$ 4.700,00. Diante disso, requer a aplicação do desconto previsto no art. 42, inciso II, da Lei Federal nº 11.977/2009.  Imóvel: Localizado na  Av. Bom Jesus, no Lote 12, Quadra 03, constituído por 3 (unidades), totalizando 181,02m  que tomou o número 196, Casa 01, n˚ 196-01 e Casa 02, n˚ 196-02, e Casa 03, n˚ 196-03, Loteamento Parque das Fruteiras, CEP: 59575-000, Extremoz/RN. Matrícula nº: 45.504.  Art. 42 – Os emolumentos devidos pelos atos de abertura de matrícula, registro de incorporação, parcelamento do solo, averbação de construção, instituição de condomínio, averbação da carta de "habite-se" e demais atos referentes à construção de empreendimentos no âmbito do PMCMV serão reduzidos em: II – 50% (cinquenta por cento) para os atos relacionados aos demais empreendimentos do PMCMV.  Nestes termos, Pede deferimento.  Extremoz/RN, 12 de Agosto de 2026.

____________________________________________________
NOVO PLANO INCORPORAÇÃO IMOBILIÁRIA LTDA
CNPJ: 61.041.452/0001-06`,
    guidance: "O modelo mostra NOVO PLANO INCORPORAÇÃO IMOBILIÁRIA LTDA só como EXEMPLO de formatação — não é um valor fixo. O DECLARANTE (razão social, CNPJ, endereço, nome/CPF/CNH do representante) é a empresa incorporadora DESTE projeto específico, e deve ser extraído dos documentos-fonte anexados (procure entre eles um contrato social, cartão CNPJ ou procuração — é comum o usuário anexar exatamente esse tipo de documento pra isso). Use os dados reais que encontrar nos documentos-fonte, mesmo que a empresa seja diferente da do modelo. Só use '[NÃO ENCONTRADO — PREENCHER MANUALMENTE]' se realmente não achar essa informação em nenhum documento-fonte. Troque também os dados do IMÓVEL (endereço, lote, quadra, número de unidades, área total, números das casas, loteamento, CEP, cidade, matrícula) usando o que for encontrado nos documentos-fonte. Atualize a data final para a data de hoje, no formato 'Extremoz/RN, [dia] de [mês por extenso] de [ano]'."
  },
  requerimento_averbacao: {
    label: "Requerimento de Averbação (Cartório)",
    template: `NOVO PLANO INCORPORAÇÃO IMOBILIÁRIA LTDA  – Rua Rio Tocantins, S/N, Lot. Jardim dos Pampas, Bairro, Centro - Município de Extremoz (RN) - CEP 59575-000.


Ilustríssimo Senhor Oficial do Registro de Imóvel de Extremoz/RN

A empresa NOVO PLANO INCORPORAÇÃO IMOBILIÁRIA LTDA vem requerer a Vossa Senhoria a AVERBAÇÃO, na matrícula de número 45.504, desse Ofício, da construção de um condomínio residencial multifamiliar, de caráter popular, com área global construída de 60,34 m² (cada), constituído por 3 (unidades), totalizando 181,02m² que tomou o número 196, Casa 01, n˚ 196-01 e Casa 02, n˚ 196-02, e Casa 03, n˚ 196-03 da Av. Bom Jesus, no Lote 12, Quadra 03, para o que anexa os seguintes documentos:

(x) Certidão de Habite-se ou Auto de Conclusão;
(x) Declaração do proprietário, de que o imóvel será objeto de financiamento pelo Programa Minha Casa, Minha Vida, para redução de custas cartoriais em 50%;
(x) Alvará de Construção;
(x) Certidão de Característica;
(x) RRT de Projeto e RRT de Execução de obra;
(x) Planta do imóvel carimbada e aprovada pelo setor competente da Prefeitura Municipal de Extremoz/RN;
(x) CND do IPTU;
(x) Quadro da ABNT;
(x) Instrumento Particular de Instituição de Condomínio.

Nestes termos, pede deferimento.

Extremoz/RN, 12 de Agosto de 2026.






NOVO PLANO INCORPORAÇÃO IMOBILIÁRIA LTDA
                    CNPJ: 61.041.452/0001-06






NOVO PLANO INCORPORAÇÃO IMOBILIÁRIA LTDA  – Rua Rio Tocantins, S/N, Lot. Jardim dos Pampas, Bairro, Centro - Município de Extremoz (RN) - CEP 59575-000.`,
    guidance: "O modelo mostra NOVO PLANO INCORPORAÇÃO IMOBILIÁRIA LTDA só como EXEMPLO de formatação — não é um valor fixo. O REQUERENTE (razão social, CNPJ, endereço) é a empresa incorporadora DESTE projeto específico, e deve ser extraído dos documentos-fonte anexados (procure entre eles um contrato social, cartão CNPJ ou procuração — é comum o usuário anexar exatamente esse tipo de documento pra isso). Use os dados reais que encontrar, mesmo que a empresa seja diferente da do modelo; só use '[NÃO ENCONTRADO — PREENCHER MANUALMENTE]' se realmente não achar essa informação em nenhum documento-fonte. Troque também os dados do imóvel (número da matrícula, área construída de cada unidade, quantidade de unidades, área total, números das casas, endereço/lote/quadra, loteamento) pelo que for encontrado nos documentos-fonte. Na lista de documentos anexados (x), marque (x) só nos tipos de documento que você realmente identificar como anexados/existentes entre os documentos-fonte fornecidos, e deixe ( ) sem x nos que não identificar — não copie as marcações do modelo. Atualize a data para hoje, no formato 'Extremoz/RN, [dia] de [mês por extenso] de [ano]'."
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const body = await req.json();
    const tmpl = DOC_TEMPLATES[body.docType];
    if (!tmpl) return json({ error: "Tipo de documento inválido" }, 400);

    const sourceSpecs = Array.isArray(body.sources) ? body.sources : [];
    if (!sourceSpecs.length) return json({ error: "Envie pelo menos um documento fonte" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    let sources;
    try {
      sources = await Promise.all(sourceSpecs.map((spec: any, i: number) => prepareDoc(spec, supabase, "fonte " + (i + 1))));
    } catch (e) {
      return json({ error: String(e instanceof Error ? e.message : e) }, 400);
    }

    const today = new Date();
    const todayStr = today.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric", timeZone: "America/Fortaleza" });

    const prompt =
      "Você vai preencher um documento de construção civil brasileiro do tipo \"" + tmpl.label + "\" usando dados " +
      "reais extraídos dos documentos-fonte anexados (matrícula, contrato, alvará, certidão de característica etc — " +
      "inclusive digitalizações/escaneados). Data de hoje: " + todayStr + ".\n\n" +
      "MODELO DE REFERÊNCIA — use SÓ pra copiar a estrutura, formatação, quebras de linha, numeração de seções e tom. " +
      "TODOS os dados concretos dentro dele (nomes, CNPJ, CPF, endereços, números de matrícula/lote/quadra, valores, " +
      "marcações (x) etc.) são de um outro caso, só de exemplo — NUNCA copie um dado concreto do modelo pro documento " +
      "final; todo dado concreto tem que vir dos documentos-fonte deste caso, ou virar " +
      "\"[NÃO ENCONTRADO — PREENCHER MANUALMENTE]\" se não for encontrado neles:\n" +
      "-----\n" + tmpl.template + "\n-----\n\n" +
      "INSTRUÇÕES ESPECÍFICAS PARA ESTE TIPO DE DOCUMENTO:\n" + tmpl.guidance + "\n\n" +
      "REGRAS GERAIS:\n" +
      "- Leia todos os documentos-fonte por inteiro antes de preencher.\n" +
      "- Quando não encontrar um dado necessário em nenhum documento-fonte, escreva exatamente " +
      "\"[NÃO ENCONTRADO — PREENCHER MANUALMENTE]\" no lugar dele — nunca invente informação e nunca reaproveite um " +
      "dado do modelo de referência só porque faltou algo.\n" +
      "- Mantenha a estrutura, quebras de linha, numeração de seções e formatação do modelo o mais fiel possível — " +
      "só os dados concretos mudam, não o formato.\n" +
      "- Responda SOMENTE com o texto final do documento pronto, sem comentários, sem explicações, sem marcação markdown, " +
      "sem aspas ao redor do texto todo — apenas o conteúdo do documento em texto puro, pronto pra copiar.";

    const content: any[] = [{ type: "text", text: "Documentos-fonte:" }];
    sources.forEach((s: any, i: number) => {
      content.push({ type: "text", text: "Fonte " + (i + 1) + " (\"" + s.name + "\"):" });
      content.push(s.block);
    });
    content.push({ type: "text", text: prompt });

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 4000,
        messages: [{ role: "user", content }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return json({ error: "Erro na IA: " + errText.slice(0, 300) }, 500);
    }

    const aiJson = await aiRes.json();
    if (aiJson.stop_reason === "max_tokens") {
      return json({ error: "A resposta da IA ficou grande demais e foi cortada. Tente novamente." }, 500);
    }
    const textOut = (aiJson.content || []).map((b: any) => b.text || "").join("").trim();
    if (!textOut) return json({ error: "A IA não retornou nenhum texto." }, 500);

    return json({ documentText: textOut, docType: body.docType });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
