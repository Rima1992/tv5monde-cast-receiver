/**
 * TV5Monde Plus – CAF v3 Custom Receiver
 * DEBUG VERSION — logs détaillés pour identifier les problèmes Cast DRM
 */

'use strict';

// ── Helpers de log ────────────────────────────────────────────────────────────
function logInfo(msg)  { console.log('[TV5Receiver] ✅ ' + msg); }
function logWarn(msg)  { console.warn('[TV5Receiver] ⚠️  ' + msg); }
function logError(msg) { console.error('[TV5Receiver] ❌ ' + msg); }
function logDebug(msg) { console.log('[TV5Receiver] 🔍 ' + msg); }
function logCast(msg)  { console.log('[TV5Receiver] 📡 ' + msg); }

// ── 1. Contexte CAF v3 ────────────────────────────────────────────────────────
logCast('Initialisation du receiver...');
const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();
logInfo('CastReceiverContext et PlayerManager obtenus');

// ── 2. Stockage du token Nagra ────────────────────────────────────────────────
let nagraToken = null;

// ── 3. Intercepter le LOAD ────────────────────────────────────────────────────
playerManager.setMessageInterceptor(
  cast.framework.messages.MessageType.LOAD,
  (loadRequestData) => {
    logCast('═══════════════════════════════════════════');
    logCast('LOAD intercepté');
    logDebug('contentId       : ' + (loadRequestData.media && loadRequestData.media.contentId));
    logDebug('contentType     : ' + (loadRequestData.media && loadRequestData.media.contentType));
    logDebug('streamType      : ' + (loadRequestData.media && loadRequestData.media.streamType));
    logDebug('customData type : ' + typeof loadRequestData.customData);
    logDebug('customData keys : ' + (loadRequestData.customData ? JSON.stringify(Object.keys(loadRequestData.customData)) : 'null'));

    const customData = loadRequestData.customData;

    if (!customData) {
      logWarn('customData absent → token Nagra non reçu via LOAD');
    } else {
      logDebug('customData complet : ' + JSON.stringify(customData).substring(0, 200));

      // Chemin 1 : direct
      if (customData['nv-authorizations']) {
        nagraToken = customData['nv-authorizations'];
        logInfo('Token Nagra lu depuis customData["nv-authorizations"] (longueur=' + nagraToken.length + ')');
        logDebug('Token(30) : ' + nagraToken.substring(0, 30) + '...');
      }
      // Chemin 2 : sous-objet drm
      else if (customData.drm && customData.drm['nv-authorizations']) {
        nagraToken = customData.drm['nv-authorizations'];
        logInfo('Token Nagra lu depuis customData.drm["nv-authorizations"] (longueur=' + nagraToken.length + ')');
      }
      // Chemin 3 : sous-objet nagra
      else if (customData.nagra && customData.nagra.token) {
        nagraToken = customData.nagra.token;
        logInfo('Token Nagra lu depuis customData.nagra.token (longueur=' + nagraToken.length + ')');
      } else {
        logWarn('customData présent mais pas de token Nagra trouvé → contenu non-DRM ou clé inattendue');
        logWarn('customData reçu : ' + JSON.stringify(customData).substring(0, 300));
      }
    }

    // Log de l'état du token après lecture
    if (nagraToken) {
      logInfo('Token Nagra disponible → sera injecté dans les requêtes de licence Widevine');
    } else {
      logWarn('Aucun token Nagra → live non-DRM ou problème de transmission depuis Android');
    }

    logCast('═══════════════════════════════════════════');
    return loadRequestData;
  }
);

// ── 4. Écouter les sendMessage() depuis Android ───────────────────────────────
context.addCustomMessageListener(
  'urn:x-cast:com.bitmovin.player.caf',
  (event) => {
    logCast('───────────────────────────────────────────');
    logCast('Message custom reçu sur namespace Bitmovin CAF');
    logDebug('senderId  : ' + event.senderId);
    logDebug('data type : ' + typeof event.data);
    logDebug('data raw  : ' + String(event.data).substring(0, 200));

    try {
      const message = typeof event.data === 'string'
        ? JSON.parse(event.data)
        : event.data;

      logDebug('message.type : ' + (message && message.type));

      if (message && message.type === 'nagra-drm-token') {
        if (message['nv-authorizations']) {
          nagraToken = message['nv-authorizations'];
          logInfo('Token Nagra MIS À JOUR via sendMessage (longueur=' + nagraToken.length + ')');
          logDebug('Token(30) : ' + nagraToken.substring(0, 30) + '...');
        } else {
          logWarn('Message type nagra-drm-token reçu mais champ nv-authorizations absent');
          logWarn('Message : ' + JSON.stringify(message).substring(0, 200));
        }
      } else {
        logDebug('Message type non reconnu : ' + (message && message.type) + ' → ignoré');
      }
    } catch (e) {
      logError('Erreur parsing message custom : ' + e.message);
      logDebug('Data brute : ' + String(event.data).substring(0, 200));
    }
    logCast('───────────────────────────────────────────');
  }
);

// ── 5. Injection du token dans les requêtes Widevine ─────────────────────────
function setupLicenseRequestHandler() {
  const playbackConfig = new cast.framework.PlaybackConfig();

  playbackConfig.licenseRequestHandler = (requestInfo) => {
    logCast('licenseRequestHandler appelé');
    logDebug('  → URL licence : ' + (requestInfo.url || 'inconnue'));
    logDebug('  → nagraToken présent : ' + (nagraToken !== null));

    if (!nagraToken) {
      logWarn('licenseRequestHandler: pas de token Nagra — requête envoyée SANS nv-authorizations');
      logWarn('  → Le serveur Nagra risque de répondre 401');
      return;
    }

    if (!requestInfo.headers) {
      requestInfo.headers = {};
    }
    requestInfo.headers['nv-authorizations'] = nagraToken;
    requestInfo.headers['Accept']            = 'application/octet-stream';
    requestInfo.headers['Content-Type']      = 'application/octet-stream';
    logInfo('nv-authorizations injecté dans la requête de licence (token longueur=' + nagraToken.length + ')');
  };

  context.setPlaybackConfig(playbackConfig);
  logInfo('PlaybackConfig.licenseRequestHandler enregistré');
}

// ── 6. Logs sur les événements player ────────────────────────────────────────
playerManager.addEventListener(
  cast.framework.events.EventType.MEDIA_STATUS,
  (event) => {
    logDebug('MEDIA_STATUS → playerState=' + (event.mediaStatus && event.mediaStatus.playerState));
  }
);

playerManager.addEventListener(
  cast.framework.events.EventType.ERROR,
  (event) => {
    logError('Erreur player : ' + JSON.stringify(event).substring(0, 300));
    logError('  → detailedErrorCode : ' + (event.detailedErrorCode));
    logError('  → reason : ' + (event.reason));
  }
);

playerManager.addEventListener(
  cast.framework.events.EventType.PLAYER_LOAD_COMPLETE,
  () => {
    logInfo('PLAYER_LOAD_COMPLETE → source chargée avec succès');
    logDebug('  → nagraToken présent au moment du load : ' + (nagraToken !== null));
  }
);

playerManager.addEventListener(
  cast.framework.events.EventType.BITRATE_CHANGED,
  (event) => {
    logDebug('BITRATE_CHANGED → ' + event.totalBitrate + ' bps');
  }
);

// ── 7. Démarrage ──────────────────────────────────────────────────────────────
// IMPORTANT : setupLicenseRequestHandler() AVANT context.start()
setupLicenseRequestHandler();

context.start({
  touchScreenOptimizedApp: false,
  maxInactivity: 3600,
});

logInfo('══════════════════════════════════════════');
logInfo('Receiver TV5Monde Plus démarré');
logInfo('Version debug — tous les logs actifs');
logInfo('Pour débugger : chrome://inspect/#devices');
logInfo('══════════════════════════════════════════');
