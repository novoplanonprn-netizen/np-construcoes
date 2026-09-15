// Edge Function: analyze-document
// Compara UM documento "a conferir" (docA) contra UM OU MAIS documentos de referência
// (docsB) — todos inteiros, sem lista fixa de campos. A IA lê o conteúdo completo de tudo
// e devolve todos os dados comparáveis que encontrou, dizendo se batem ou divergem, e (quando
// há mais de uma referência) de qual documento de referência veio cada valor.
//
// Entrada: { docA, docsB } — docA é um objeto, docsB é um ARRAY de 1+ objetos, cada um no formato:
//   { documentId }                                  -> documento já arquivado (lê do Storage)
//   { fileBase64, fileName, mimeType }               -> arquivo anexado só pra conferência
// (por compatibilidade, também aceita { docA, docB } com docB single — vira docsB de 1 item)
//
// Deploy: supabase functions deploy analyze-document
// Precisa do secret ANTHROPIC_API_KEY (supabase secrets set ANTHROPIC_API_KEY=...).
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const body = await req.json();
    const docsBSpecs = Array.isArray(body.docsB) ? body.docsB : (body.docB ? [body.docB] : []);
    if (!body.docA || !docsBSpecs.length) return json({ error: "Envie docA e docsB (pelo menos um documento de referência)" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    let docA: { name: string; block: any };
    let docsB: { name: string; block: any }[];
    try {
      docA = await prepareDoc(body.docA, supabase, "A");
      docsB = await Promise.all(docsBSpecs.map((spec: any, i: number) => prepareDoc(spec, supabase, "B" + (i + 1))));
    } catch (e) {
      return json({ error: String(e instanceof Error ? e.message : e) }, 400);
    }

    const multi = docsB.length > 1;
    const refListText = docsB.map((d, i) => (i + 1) + ". " + d.name).join("\n");

    const prompt =
      "Você vai conferir um documento de construção civil brasileiro (\"Documento A\", o que está sendo checado) " +
      "contra " + (multi ? "os seguintes documentos de referência (já sabidos corretos)" : "um documento de referência (já sabido correto)") + ":\n" +
      refListText + "\n\n" +
      "Documento A: \"" + docA.name + "\".\n\n" +
      "Os documentos podem ser matrícula, quadro ABNT, habite-se, averbação, características do imóvel/IPTU, RRT, " +
      "contrato social, certidão, CND, planta, contrato etc — inclusive digitalizações/escaneadas de baixa qualidade, " +
      "com texto manuscrito ou carimbado.\n\n" +
      "Leia TODOS os documentos por inteiro, com atenção. Para cada dado do Documento A, procure ativamente o campo " +
      "CORRESPONDENTE (mesmo tipo de informação — mesmo conceito, não precisa ser exatamente a mesma redação ou " +
      "rótulo) em " + (multi ? "algum dos documentos de referência" : "o documento de referência") + ". Por exemplo: " +
      "\"inscrição municipal\", \"inscrição municipal da unidade\" e \"cadastro municipal\" são o MESMO tipo de campo " +
      "mesmo com nomes diferentes; um número de sequencial, protocolo, matrícula ou registro no Documento A deve ser " +
      "comparado com o número equivalente na referência sempre que os dois parecerem se referir à mesma coisa (mesmo " +
      "imóvel/unidade/pessoa), mesmo que o contexto ao redor não seja idêntico.\n\n" +
      "Encontrando um campo correspondente, compare os valores: se forem iguais (ignorando diferenças cosméticas — " +
      "formatação, unidade de medida escrita ou não, ex.: \"182,80m²\" e \"182,80\" são o MESMO valor — maiúsculas/" +
      "minúsculas, espaços, pontuação), marque \"bate\"; se os valores forem diferentes de verdade — mesmo que a " +
      "diferença seja só em alguns dígitos ou caracteres — marque \"diverge\" e mostre os dois valores. " +
      "IMPORTANTE: só use \"so_a\"/\"so_b\" quando você não conseguir achar NENHUM campo comparável (nem parecido) " +
      "na referência — nunca use \"so_a\"/\"so_b\" só porque os valores são diferentes entre si; valores diferentes " +
      "no mesmo tipo de campo são sempre \"diverge\", não \"so_a\"/\"so_b\". Na dúvida se dois campos são o mesmo " +
      "conceito, prefira compará-los (marcando diverge se os valores não baterem) a descartá-los como não " +
      "relacionados — é melhor apontar uma divergência duvidosa do que esconder um erro real.\n\n" +
      "NÃO se limite a uma lista fixa de campos — procure qualquer informação relevante: lote, quadra, bairro, " +
      "endereço, cidade, matrícula, nomes de pessoas/empresas, CPF/CNPJ, áreas, medidas, quantidade de " +
      "cômodos/unidades, datas, números de registro/protocolo/RRT/CREA, responsáveis técnicos, valores, e qualquer " +
      "outro dado comparável.\n\n" +
      "Responda SOMENTE com um JSON válido, sem nenhum texto fora dele, no formato:\n" +
      '{"achados": [{"campo": "nome do dado (curto, em português)", "valor_a": "valor no Documento A ou null", ' +
      '"valor_b": "valor encontrado na referência ou null", "fonte_b": "nome do documento de referência de onde veio valor_b (ou null)", ' +
      '"status": "bate"}]}\n\n' +
      'O campo "status" deve ser exatamente um destes: "bate" (mesma informação), "diverge" (informação realmente ' +
      'diferente), "so_a" (só aparece no Documento A), "so_b" (só aparece na referência, não no Documento A).\n' +
      "Liste só os dados que você realmente encontrou — não invente informação que não está escrita nos documentos.";

    const content: any[] = [{ type: "text", text: "Documento A (a conferir):" }, docA.block];
    docsB.forEach((d, i) => {
      content.push({ type: "text", text: "Documento de referência " + (i + 1) + " (\"" + d.name + "\"):" });
      content.push(d.block);
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
        max_tokens: 8000,
        messages: [{ role: "user", content }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return json({ error: "Erro na IA: " + errText.slice(0, 300) }, 500);
    }

    const aiJson = await aiRes.json();
    const textOut = (aiJson.content || []).map((b: any) => b.text || "").join("").trim();

    if (aiJson.stop_reason === "max_tokens") {
      return json({ error: "A resposta da IA ficou grande demais e foi cortada (muitos documentos de referência de uma vez). Tente analisar com menos documentos de referência por vez." }, 500);
    }

    let parsed: any = null;
    try {
      const match = textOut.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : textOut);
    } catch (_e) {
      parsed = null;
    }
    if (!parsed || !Array.isArray(parsed.achados)) {
      return json({ error: "Não consegui interpretar a resposta da IA. Tente novamente." }, 500);
    }

    return json({ achados: parsed.achados, docAName: docA.name, docsBNames: docsB.map((d) => d.name) });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
