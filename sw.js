/* Service worker do Aplica-es.
 *
 * POR QUE ELE EXISTE. O aplicativo guardava os dados do Aplicador no
 * armazenamento do aparelho e mesmo assim NÃO abria sem internet: ao fechar
 * e reabrir, o navegador precisa buscar a própria página na rede, e sem rede
 * a tela era a do dinossauro do Chrome ("ERR_INTERNET_DISCONNECTED"). Ter os
 * dados salvos não adianta nada se o app não carrega para lê-los.
 *
 * Este arquivo resolve exatamente isso: guarda a CASCA do aplicativo (o
 * HTML e o bundle) e a serve quando a rede não responde.
 *
 * O QUE ELE DELIBERADAMENTE NÃO FAZ: não guarda nada do Supabase. As
 * chamadas de API precisam FALHAR quando não há rede, porque é a falha que
 * faz o `cachedFetch` do app cair no cache dele — que sabe o que é dado
 * velho e o que é dado novo. Um service worker respondendo com uma cópia
 * antiga de uma consulta faria o app achar que está online e mostrar saldo
 * de estoque vencido como se fosse atual.
 */

const CACHE = 'aplicaes-casca-v1';

self.addEventListener('install', (event) => {
  // Assume o controle já na primeira visita: sem isto, a primeira vez que o
  // usuário abrisse o app não ficaria protegida — e a primeira vez é
  // justamente quando ele vai para a lavoura sem ter testado.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const nomes = await caches.keys();
      await Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Só a própria origem. Supabase, Storage e qualquer API ficam de fora —
  // ver o comentário do topo.
  if (url.origin !== self.location.origin) return;

  // Navegação (abrir ou recarregar o app): rede primeiro, para o usuário
  // receber a versão nova assim que houver rede; cache quando não houver.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const resposta = await fetch(req);
          const cache = await caches.open(CACHE);
          // Guarda sempre sob a mesma chave: as rotas do app são todas
          // servidas pelo mesmo HTML, então cachear por URL encheria o
          // cache com cópias iguais e ainda deixaria rotas descobertas.
          cache.put(cascaKey(), resposta.clone());
          return resposta;
        } catch (e) {
          const cache = await caches.open(CACHE);
          const guardada = await cache.match(cascaKey());
          if (guardada) return guardada;
          throw e;
        }
      })(),
    );
    return;
  }

  // Demais arquivos da origem (bundle, ícones): cache primeiro, atualizando
  // por trás. O bundle tem hash no nome, então servir do cache é seguro.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const guardada = await cache.match(req);
      const daRede = fetch(req)
        .then((resposta) => {
          if (resposta && resposta.ok) cache.put(req, resposta.clone());
          return resposta;
        })
        .catch(() => null);
      return guardada || (await daRede) || Response.error();
    })(),
  );
});

function cascaKey() {
  return new Request(self.registration.scope, { mode: 'same-origin' });
}
