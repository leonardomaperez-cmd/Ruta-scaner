package ar.leo.rutaescaner;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.util.ArrayList;
import java.util.List;

// Lee el texto de la foto con ML Kit de Google, en el teléfono y sin internet.
@CapacitorPlugin(name = "LectorTexto")
public class LectorTextoPlugin extends Plugin {
    private TextRecognizer lector;

    @PluginMethod
    public void leer(PluginCall call) {
        String img = call.getString("image", "");
        int coma = img.indexOf(',');
        if (coma >= 0) img = img.substring(coma + 1);
        Bitmap bmp;
        try {
            byte[] bytes = Base64.decode(img, Base64.DEFAULT);
            bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (Exception e) { call.reject("foto inválida"); return; }
        if (bmp == null) { call.reject("foto inválida"); return; }
        if (lector == null) lector = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        lector.process(InputImage.fromBitmap(bmp, 0))
            .addOnSuccessListener(res -> {
                // líneas de arriba hacia abajo y de izquierda a derecha
                List<Text.Line> todas = new ArrayList<>();
                for (Text.TextBlock b : res.getTextBlocks()) todas.addAll(b.getLines());
                todas.sort((a, b) -> {
                    Rect ra = a.getBoundingBox(), rb = b.getBoundingBox();
                    if (ra == null || rb == null) return 0;
                    int alto = Math.max(8, Math.min(ra.height(), rb.height()) / 2);
                    if (Math.abs(ra.top - rb.top) > alto) return ra.top - rb.top;
                    return ra.left - rb.left;
                });
                JSArray lines = new JSArray();
                for (Text.Line l : todas) lines.put(l.getText());
                JSObject out = new JSObject();
                out.put("lines", lines);
                out.put("text", res.getText());
                call.resolve(out);
            })
            .addOnFailureListener(e -> call.reject(e.getMessage() != null ? e.getMessage() : "ML Kit falló"));
    }
}
