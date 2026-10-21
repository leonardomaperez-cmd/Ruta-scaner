// Se empaqueta en www/native.js (solo en la app de Android): conecta la página con los plugins nativos.
import { registerPlugin } from "@capacitor/core";
import { Camera } from "@capacitor/camera";
import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { LocalNotifications } from "@capacitor/local-notifications";

const BackgroundGeolocation = registerPlugin("BackgroundGeolocation");
const Permisos = registerPlugin("Permisos");
window.CapPlugins = { Camera, TextToSpeech, LocalNotifications, BackgroundGeolocation, Permisos };
