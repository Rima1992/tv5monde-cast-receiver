/**
 * TV5Monde Plus – CAF v3 Custom Receiver
 *
 * Receiver CAF v3 pur (Shaka Player natif — pas de SDK Bitmovin côté receiver).
 * Le CAF v3 intègre Shaka Player comme player par défaut et ne supporte pas
 * de player tiers. On utilise donc les APIs CAF v3 standard pour injecter
 * le token Nagra dans les requêtes de licence Widevine.
 *
 * Flux du token Nagra :
 *  1. Android → customReceiverConfig { "nv-authorizations": token }
 *     → transmis dans loadRequestData.customData au moment du LOAD
 *  2. Android → sendMessage({ type: "nagra-drm-token", "nv-authorizations": token })
 *     → reçu via addCustomMessageListener (namespace urn:x-cast:com.bitmovin.player.caf)
 *  3. Le token est injecté via licenseRequestHandler dans chaque requête Widevine
 */

'use strict';

// ── 1. Contexte CAF v3 ────────────────────────────────────────────────────────
const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();

// ── 2. Stockage du token Nagra ────────────────────────────────────────────────
let nagraToken = null;

/**
 * Injecte le token Nagra dans les headers de la requête de licence Widevine.
 */
function injectNagraToken(requestInfo) {
  if (!nagraToken) {
    console.log('[TV5Receiver] Pas de token Nagra disponible');
    return;
  }
  if (!requestInfo.headers) {
    requestInfo.headers = {};
  }
  requestInfo.headers['nv-authorizations'] = nagraToken;
  requestInfo.headers['Accept']            = 'application/octet-stream';
  requestInfo.headers['Content-Type']      = 'application/octet-stream';
  console.log('[TV5Receiver] Token Nagra injecté (longueur=' + nagraToken.length + ')');
}

// ── 3. Intercepter le LOAD pour lire customData ───────────────────────────────
/**
 * Android passe le token via :
 *   RemoteControlConfig.customReceiverConfig = { "nv-authorizations": token }
 * Bitmovin le place dans loadRequestData.customData.
 */
playerManager.setMessageInterceptor(
  cast.framework.messages.MessageType.LOAD,
  (loadRequestData) => {
    console.log('[TV5Receiver] LOAD intercepté');

    // Lire le token depuis customData
    const customData = loadRequestData.customData;
    if (customData) {
      if (customData['nv-authorizations']) {
        nagraToken = customData['nv-authorizations'];
        console.log('[TV5Receiver] Token Nagra lu depuis customData (longueur=' + nagraToken.length + ')');
      }
      // Bitmovin encapsule parfois dans un sous-objet "drm"
      if (!nagraToken && customData.drm && customData.drm['nv-authorizations']) {
        nagraToken = customData.drm['nv-authorizations'];
        console.log('[TV5Receiver] Token Nagra lu depuis customData.drm');
      }
    }

    if (!nagraToken) {
      console.warn('[TV5Receiver] Aucun token Nagra dans customData — contenu non DRM ou token manquant');
    }

    return loadRequestData;
  }
);

// ── 4. Écouter les sendMessage() depuis Android ───────────────────────────────
/**
 * Android envoie le token via BitmovinCastManager.sendMessage() sur le namespace
 * urn:x-cast:com.bitmovin.player.caf après CastStarted.
 * Format : { "type": "nagra-drm-token", "nv-authorizations": "<token>" }
 */
context.addCustomMessageListener(
  'urn:x-cast:com.bitmovin.player.caf',
  (event) => {
    try {
      const message = typeof event.data === 'string'
        ? JSON.parse(event.data)
        : event.data;

      console.log('[TV5Receiver] Message reçu: type=' + message.type);

      if (message.type === 'nagra-drm-token' && message['nv-authorizations']) {
        nagraToken = message['nv-authorizations'];
        console.log('[TV5Receiver] Token Nagra mis à jour via sendMessage (longueur=' + nagraToken.length + ')');
      }
    } catch (e) {
      console.warn('[TV5Receiver] Erreur parsing message: ' + e.message);
    }
  }
);

// ── 5. Injecter le token dans les requêtes de licence Widevine ────────────────
/**
 * playbackConfig.licenseRequestHandler est appelé par Shaka Player (intégré au CAF v3)
 * avant chaque requête vers le serveur de licence Widevine.
 * C'est ici que le header nv-authorizations est ajouté.
 */
const playbackConfig = new cast.framework.PlaybackConfig();

playbackConfig.licenseRequestHandler = (requestInfo) => {
  injectNagraToken(requestInfo);
};

context.setPlaybackConfig(playbackConfig);

// ── 6. Démarrage du receiver ──────────────────────────────────────────────────
context.start({
  touchScreenOptimizedApp: false,
  maxInactivity: 3600,
});

console.log('[TV5Receiver] CAF v3 Receiver TV5Monde Plus démarré');
