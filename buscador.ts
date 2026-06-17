
interface OSMNode {
  tags?: {
    name?: string;
    phone?: string;
    'contact:phone'?: string;
    email?: string;
    'contact:email'?: string;
    website?: string;
    'contact:website'?: string;
  };
}

async function cacarContatosNoSite(url: string) {
  try {
    const urlFormatada = url.startsWith('http') ? url : `http://${url}`;
    
    const resposta = await fetch(urlFormatada, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(5000)
    });
    
    const html = await resposta.text();

    const regexEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emailsEncontrados = html.match(regexEmail) || [];
    
    const regexTelefone = /\(?\d{2}\)?\s?(?:9\d{4}|\d{4})[-.\s]?\d{4}/g;
    const telefonesEncontrados = html.match(regexTelefone) || [];

    const emailsLimpos = [...new Set(emailsEncontrados)].filter(e => !e.endsWith('.png') && !e.endsWith('.jpg'));
    const telefonesLimpos = [...new Set(telefonesEncontrados)];

    return {
      emailsExtra: emailsLimpos.slice(0, 3),
      telefonesExtra: telefonesLimpos.slice(0, 3)
    };
  } catch (error) {
    return { emailsExtra: [], telefonesExtra: [] };
  }
}

function limparNomeEscola(nome: string): string {
  return nome.replace(/\b(E\.E\.|E\.M\.|EMEF|EMEI|CEI|CMEI|EE|EM|Colégio|Escola Estadual|Escola Municipal)\b/gi, '').trim();
}

async function buscarNoQEdu(nomeOriginal: string) {
  try {
    const nomeLimpo = limparNomeEscola(nomeOriginal);
    if (!nomeLimpo) return { encontrado: false };

    const urlBusca = `https://qedu.org.br/busca?q=${encodeURIComponent(nomeLimpo)}`;
    const resposta = await fetch(urlBusca, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(5000)
    });
    
    const html = await resposta.text();

    const matchLink = html.match(/href="(\/escola\/(\d+)-[^"]+)"/);
    
    if (matchLink && matchLink[1] && matchLink[2]) {
      const urlEscola = `https://qedu.org.br${matchLink[1]}`;
      const inep = matchLink[2]; 
      return { encontrado: true, inep, urlEscola };
    }
    
    return { encontrado: false };
  } catch (error) {
    return { encontrado: false };
  }
}

async function buscarEscolas(endereco: string, raio: number = 2000) {
  console.log(`A pesquisar coordenadas para: ${endereco}...`);
  
  try {
    const urlGeo = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(endereco)}&format=json&limit=1`;
    const geoRes = await fetch(urlGeo, { headers: { 'User-Agent': 'BuscadorEscolas-App-V3/3.0' } });
    const geoData = await geoRes.json();

    if (geoData.length === 0) {
      console.log("❌ Localização não encontrada. Tente ser mais específico.");
      return;
    }

    const { lat, lon, display_name } = geoData[0];
    console.log(`\n📍 Ponto base: ${display_name}`);
    console.log(`🔍 A procurar escolas, a analisar sites e a cruzar dados com o QEdu... (Isto pode demorar um pouco)\n`);

    const overpassQuery = `[out:json]; node["amenity"="school"](around:${raio},${lat},${lon}); out;`;
    
    const escolasRes = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { 
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "BuscadorEscolas-App-V3/3.0"
      },
      body: `data=${encodeURIComponent(overpassQuery)}`
    });

    if (!escolasRes.ok) {
      const textoErro = await escolasRes.text();
      console.error(`\n❌ A API do mapa recusou a ligação (Código HTTP: ${escolasRes.status})`);
      return;
    }

    const escolasData = await escolasRes.json();
    const escolas = escolasData.elements;

    if (!escolas || escolas.length === 0) {
      console.log("Nenhuma escola encontrada nesta área com dados abertos.");
      return;
    }

    let totalEncontrado = 0;
    
    for (const school of escolas) {
      const tags = school.tags || {};
      const nome = tags.name;
      if (!nome) continue; 
      
      totalEncontrado++;
      let telefone = tags.phone || tags['contact:phone'];
      let email = tags.email || tags['contact:email'];
      const site = tags.website || tags['contact:website'];

      // 1. Pesquisa de contactos no próprio site da escola
      let contatosCacados: { emailsExtra: string[], telefonesExtra: string[] } = { emailsExtra: [], telefonesExtra: [] };
      if (site) {
        contatosCacados = await cacarContatosNoSite(site);
      }

      const qeduDados = await buscarNoQEdu(nome);

      const exibeTelefone = telefone ? telefone : (contatosCacados.telefonesExtra.length > 0 ? contatosCacados.telefonesExtra.join(" / ") : "Não encontrado");
      const exibeEmail = email ? email : (contatosCacados.emailsExtra.length > 0 ? contatosCacados.emailsExtra.join(" / ") : "Não encontrado");
      
      console.log(`🏫 Escola: ${nome}`);
      console.log(`📞 Telefone(s): ${exibeTelefone}`);
      console.log(`📧 E-mail(s): ${exibeEmail}`);
      console.log(`🌐 Site: ${site || "Não cadastrado"}`);
      
      if (qeduDados.encontrado) {
        console.log(`📚 QEdu / INEP: Código ${qeduDados.inep} -> ${qeduDados.urlEscola}`);
      } else {
        console.log(`📚 QEdu: Escola não identificada na base de dados (ou com nome muito divergente).`);
      }
      
      if (exibeTelefone === "Não encontrado" && exibeEmail === "Não encontrado") {
        const linkGoogle = `https://www.google.com/search?q=${encodeURIComponent(nome + " contato telefone " + endereco)}`;
        console.log(`🔎 Pesquisa no Google: ${linkGoogle}`);
      }
      console.log("-".repeat(60));
    }

    console.log(`\n✅ Processo finalizado! Foram verificadas ${totalEncontrado} escolas.`);

  } catch (error) {
    console.error("Erro durante a execução:", error);
  }
}

const localDesejado = process.argv[2] || "Pinheiros, São Paulo";
buscarEscolas(localDesejado);