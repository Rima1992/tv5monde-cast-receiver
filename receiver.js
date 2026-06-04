/**
 * TV5Monde Plus – Bitmovin CAF Custom Receiver
 *
 * Objectif : injecter le token Nagra (nv-authorizations) dans chaque requête
 * de licence Widevine pour les contenus live DRM TV5Monde.
 *
 * Flux :
 *  1. L'app Android crée le Player avec customReceiverConfig = { "nv-authorizations": token }
 *  2. Ce receiver lit le token dans customData à la connexion (LOAD request)
 *  3. Le token est aussi mis à jour via sendMessage() si la session Cast démarre
 *     après le chargement de la source (namespace urn:x-cast:com.bitmovin.player.caf)
 *  4. Le token est injecté dans playbackConfig.licenseRequestHandler pour
 *     toutes les requêtes vers le serveur de licence Nagra Widevine
 *
 * Déploiement :
 *  - Héberger index.html + receiver.js sur HTTPS (ex: GitHub Pages, Firebase Hosting)
 *  - Enregistrer l'URL sur https://cast.google.com/publish/#/signup
 *  - Mettre l'App ID résultant dans android/fuzyo-player-sdk/src/main/res/values/strings.xml
 *    comme valeur de app_id
 */

'use strict';

// ── 1. Contexte CAF ────────────────────────────────────────────────────────────
const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();

// ── 2. Initialisation du receiver Bitmovin ────────────────────────────────────
const bitmovinReceiver = new bitmovin.receiver.BitmovinReceiver(context);

// ── 3. Stockage du token Nagra (mis à jour depuis customData ou sendMessage) ──
let nagraToken = null;

/**
 * Injecte le token Nagra dans la configuration DRM d'une requête de licence.
 * Appelé dans licenseRequestHandler pour chaque requête Widevine.
 *
 * @param {Object} requestObject – objet requête CAF (modifiable in-place)
 */
function injectNagraToken(requestObject) {
  if (!nagraToken) return;

  // Injection dans les headers HTTP de la requête de licence Widevine
  if (!requestObject.headers) {
    requestObject.headers = {};
  }
  requestObject.headers['nv-authorizations'] = nagraToken;
  requestObject.headers['Accept']            = 'application/octet-stream';
  requestObject.headers['Content-Type']      = 'application/octet-stream';

  console.log('[TV5Receiver] Token Nagra injecté dans la requête de licence');
}

// ── 4. Intercepter les requêtes LOAD pour lire customData ────────────────────
/**
 * L'app Android passe le token Nagra via :
 *   RemoteControlConfig.customReceiverConfig = { "nv-authorizations": token }
 *
 * Bitmovin le transmet dans loadRequestData.customData (objet JSON) lors du LOAD.
 */
playerManager.setMessageInterceptor(
  cast.framework.messages.MessageType.LOAD,
  (loadRequestData) => {
    const customData = loadRequestData.customData;

    if (customData && customData['nv-authorizations']) {
      nagraToken = customData['nv-authorizations'];
      console.log('[TV5Receiver] Token Nagra lu depuis customData (longueur=' + nagraToken.length + ')');
    }

    return loadRequestData;
  }
);

// ── 5. Écouter les messages sendMessage() depuis l'app Android ───────────────
/**
 * L'app Android envoie le token via BitmovinCastManager.sendMessage() sur :
 *   namespace = urn:x-cast:com.bitmovin.player.caf
 *
 * Format attendu : JSON { "type": "nagra-drm-token", "nv-authorizations": "<token>" }
 *
 * Cela permet de rafraîchir le token si la session Cast démarre après
 * que la source soit déjà chargée côté Android.
 */
context.addCustomMessageListener(
  'urn:x-cast:com.bitmovin.player.caf',
  (event) => {
    try {
      const message = JSON.parse(event.data);
      console.log('[TV5Receiver] Message reçu via namespace Bitmovin: type=' + message.type);

      if (message.type === 'nagra-drm-token' && message['nv-authorizations']) {
        nagraToken = message['nv-authorizations'];
        console.log('[TV5Receiver] Token Nagra mis à jour via sendMessage (longueur=' + nagraToken.length + ')');
      }
    } catch (e) {
      console.warn('[TV5Receiver] Impossible de parser le message custom: ' + e.message);
    }
  }
);

// ── 6. Configuration de la playback – injecter le token dans licenseRequestHandler ──
/**
 * playbackConfig.licenseRequestHandler est appelé par le SDK Bitmovin CAF
 * avant CHAQUE requête vers le serveur de licence Widevine.
 *
 * C'est ici que le token Nagra est injecté dans les headers HTTP.
 * Sans ce handler, le serveur Nagra répond 401 → lecture DRM bloquée.
 */
const playbackConfig = new cast.framework.PlaybackConfig();

playbackConfig.licenseRequestHandler = (requestInfo) => {
  injectNagraToken(requestInfo);
};

context.setPlaybackConfig(playbackConfig);

// ── 7. Callback onCustomMessage du receiver Bitmovin ─────────────────────────
/**
 * Le SDK Bitmovin CAF expose aussi onCustomMessage() pour les messages
 * transmis via sendMessage() depuis l'app Android.
 * On double la gestion ici pour être compatible avec les deux mécanismes.
 */
bitmovinReceiver.onCustomMessage = (namespace, senderId, message) => {
  try {
    const parsed = JSON.parse(message);
    if (parsed.type === 'nagra-drm-token' && parsed['nv-authorizations']) {
      nagraToken = parsed['nv-authorizations'];
      console.log('[TV5Receiver] onCustomMessage: token Nagra mis à jour (longueur=' + nagraToken.length + ')');
    }
  } catch (e) {
    console.warn('[TV5Receiver] onCustomMessage: parse error → ' + e.message);
  }
};

// ── 8. Démarrage du receiver ──────────────────────────────────────────────────
context.start({
  touchScreenOptimizedApp: false,
  maxInactivity: 3600, // 1h – maintenir la session Cast active pour le live
});

console.log('[TV5Receiver] Receiver TV5Monde Plus démarré');
