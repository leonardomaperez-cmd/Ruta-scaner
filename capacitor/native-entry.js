// Se empaqueta en www/native.js (solo en la app de Android): conecta la página con los plugins nativos.
import { registerPlugin } from "@capacitor/core";
import { Camera } from "@capacitor/camera";
import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { LocalNotifications } from "@capacitor/local-notifications";
import { SpeechRecognition } from "@capacitor-community/speech-recognition";

const BackgroundGeolocation = registerPlugin("BackgroundGeolocation");
const Permisos = registerPlugin("Permisos");
const LectorTexto = registerPlugin("LectorTexto");
window.CapPlugins = { Camera, TextToSpeech, LocalNotifications, BackgroundGeolocation, Permisos, LectorTexto };

// El WebView de Android no trae reconocimiento de voz: se arma uno con el plugin nativo (el de Google del teléfono)
// con la misma forma que el del navegador, así el asistente de voz y el dictado de la referencia funcionan igual.
if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
  class NativeSR {
    constructor() { this.lang = "es-AR"; this.maxAlternatives = 1; this.onresult = null; this.onerror = null; this.onend = null; this._on = false; }
    start() {
      if (this._on) throw new Error("ya está escuchando");
      this._on = true;
      const err = (error) => { if (this.onerror) this.onerror({ error }); };
      const fin = () => { if (!this._on) return; this._on = false; if (this.onend) this.onend(); };
      (async () => {
        try {
          const p = await SpeechRecognition.checkPermissions().catch(() => ({}));
          if (p.speechRecognition !== "granted") {
            const r = await SpeechRecognition.requestPermissions();
            if (r.speechRecognition !== "granted") { err("not-allowed"); fin(); return; }
          }
          const { available } = await SpeechRecognition.available();
          if (!available) { err("service-not-allowed"); fin(); return; }
          const res = await SpeechRecognition.start({ language: this.lang, maxResults: Math.max(1, this.maxAlternatives || 1), partialResults: false, popup: false });
          const m = (res && res.matches) || [];
          if (m.length) { if (this.onresult) this.onresult({ results: [m.map(t => ({ transcript: t, confidence: 1 }))] }); }
          else err("no-speech");
        } catch (e) { err(/permis/i.test(String(e && e.message)) ? "not-allowed" : "no-speech"); }
        fin();
      })();
    }
    stop() { SpeechRecognition.stop().catch(() => {}); }
    abort() { this.stop(); }
  }
  window.SpeechRecognition = NativeSR;
}
