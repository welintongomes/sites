const CACHE_NAME = 'sites-manager-v13';
const urlsToCache = [
  './',
  './index.html'
];

// Instalar o Service Worker
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('Cache aberto');
        return cache.addAll(urlsToCache);
      })
      .catch(function(error) {
        console.log('Erro ao adicionar ao cache:', error);
      })
  );
});

// Interceptar requisições
self.addEventListener('fetch', function(event) {
  // Ignorar requisições que não são do mesmo domínio ou são para manifest
  if (!event.request.url.startsWith(self.location.origin) || 
      event.request.url.includes('manifest.json')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(function(response) {
        // Retorna do cache se disponível
        if (response) {
          console.log('Servindo do cache:', event.request.url);
          return response;
        }
        
        // Buscar da rede
        return fetch(event.request)
          .then(function(response) {
            // Verificar se é uma resposta válida
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Clonar a resposta
            var responseToCache = response.clone();

            caches.open(CACHE_NAME)
              .then(function(cache) {
                cache.put(event.request, responseToCache);
              });

            return response;
          })
          .catch(function() {
            // Se falhar, tentar servir a página principal
            if (event.request.destination === 'document') {
              return caches.match('./index.html');
            }
          });
      })
  );
});

// Ativar o Service Worker
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );

});
