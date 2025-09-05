
package com.mebloplan.scanner

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.ar.core.Config
import com.google.ar.core.Frame
import com.google.ar.core.PointCloud
import com.google.ar.core.Session
import com.google.ar.core.exceptions.*
import java.io.File
import java.util.Locale
import kotlinx.coroutines.*

class MainActivity : AppCompatActivity() {

    private var session: Session? = null
    private lateinit var info: TextView
    private lateinit var btnScan: Button
    private lateinit var btnUpload: Button
    private lateinit var progressBar: ProgressBar

    private var lastPlyFile: File? = null
    private val scope = CoroutineScope(Dispatchers.Default)
    private val CAMERA_PERMISSION_CODE = 1001

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        info = findViewById(R.id.infoText)
        btnScan = findViewById(R.id.btnScan)
        btnUpload = findViewById(R.id.btnUpload)
        progressBar = findViewById(R.id.progressBar)

        btnScan.setOnClickListener { startScan() }
        btnUpload.setOnClickListener { uploadLast() }
    }

    override fun onResume() {
        super.onResume()
        session?.resume()
        Log.d("MainActivity", "Session resumed")
    }

    override fun onPause() {
        session?.pause()
        Log.d("MainActivity", "Session paused")
        super.onPause()
    }

    private fun ensureSession(): Boolean {
        return try {
            if (session == null) {
                session = Session(this)
                val config = Config(session)
                config.depthMode = Config.DepthMode.AUTOMATIC
                session!!.configure(config)
            }
            true
        } catch (e: UnavailableArcoreNotInstalledException) {
            info.text = "Zainstaluj ARCore"
            false
        } catch (e: UnavailableDeviceNotCompatibleException) {
            info.text = "Urządzenie nieobsługiwane"
            false
        } catch (e: Exception) {
            info.text = "Błąd: ${e.message}"
            false
        }
    }

    private fun startScan() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.CAMERA),
                CAMERA_PERMISSION_CODE
            )
            return
        }
        if (!ensureSession()) return
        btnScan.isEnabled = false
        progressBar.visibility = View.VISIBLE
        scope.launch {
            val s = session ?: return@launch
            try {
                s.resume()
                // Zbierz kilka klatek chmury punktów i zapisz do PLY
                var frames = 0
                val collected = mutableListOf<Float>()
                while (frames < 60) { // ~2 sekundy
                    val frame: Frame = s.update()
                    val pc: PointCloud = frame.acquirePointCloud()
                    val buf = pc.points // FloatBuffer XYZC
                    buf.rewind()
                    while (buf.hasRemaining()) {
                        val x = buf.get()
                        val y = buf.get()
                        val z = buf.get()
                        buf.get() // confidence (unused)
                        collected.add(x); collected.add(y); collected.add(z)
                    }
                    pc.release()
                    frames++
                }
                s.pause()
                val out = File(getExternalFilesDir(null), "scan_${System.currentTimeMillis()}.ply")
                writePly(out, collected)
                withContext(Dispatchers.Main) {
                    info.text = "Zapisano: ${out.name} (~${collected.size/3} pkt)"
                    lastPlyFile = out
                    btnScan.isEnabled = true
                    progressBar.visibility = View.GONE
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    info.text = "Błąd skanowania: ${e.message}"
                    btnScan.isEnabled = true
                    progressBar.visibility = View.GONE
                }
            }
        }
    }

    override fun onDestroy() {
        session?.close()
        session = null
        super.onDestroy()
        scope.cancel()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == CAMERA_PERMISSION_CODE) {
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                startScan()
            } else {
                info.text = "Brak uprawnień do aparatu"
                btnScan.isEnabled = false
            }
        }
    }

    private fun writePly(file: File, pts: List<Float>) {
        file.printWriter().use { pw ->
            pw.println("ply")
            pw.println("format ascii 1.0")
            pw.println("element vertex ${pts.size/3}")
            pw.println("property float x")
            pw.println("property float y")
            pw.println("property float z")
            pw.println("end_header")
            var i = 0
            while (i < pts.size) {
                // Locale.US ensures '.' decimal separator regardless of device settings
                pw.println(String.format(Locale.US, "%f %f %f", pts[i], pts[i+1], pts[i+2]))
                i += 3
            }
        }
    }

    private fun uploadLast() {
        val f = lastPlyFile ?: run { info.text = "Brak pliku do wysłania"; return }
        scope.launch {
            try {
                val resp = Uploader.upload(
                    url = BuildConfig.API_URL,
                    token = BuildConfig.API_TOKEN,
                    file = f,
                    meta = mapOf(
                        "platform" to "android",
                        "format" to "ply",
                        "author" to "Jan Kowalski"
                    )
                )
                withContext(Dispatchers.Main) { info.text = resp }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { info.text = "Błąd wysyłki: ${e.message}" }
            }
        }
    }
}
