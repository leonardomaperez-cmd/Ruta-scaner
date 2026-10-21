# App de Android

GitHub Actions arma el APK con `.github/workflows/android.yml` en cada cambio de `index.html` o de esta carpeta,
y lo publica en la release «android»:
https://github.com/leonardomaperez-cmd/Ruta-scaner/releases/download/android/ruta-escaner.apk

- Usa la misma `index.html` de la web. Dentro de la app usa GPS en segundo plano
  (@capacitor-community/background-geolocation), voz nativa (text-to-speech) y notificaciones.
- `ruta-escaner.keystore` firma el APK siempre con la misma clave, para poder actualizar sin desinstalar.
