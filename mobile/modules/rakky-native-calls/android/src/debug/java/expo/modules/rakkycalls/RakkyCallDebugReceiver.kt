package expo.modules.rakkycalls

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import org.json.JSONObject

/** A shell-only synthetic invite harness. Never included in a release APK. */
class RakkyCallDebugReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == "com.rackyride.calls.TEST_CLEAR") { RakkyCallState.clear(context); return }
    val base = intent.getStringExtra("baseUrl") ?: return
    val payload = intent.getStringExtra("payload")?.let { JSONObject(it) } ?: return
    val registration = payload.optString("registrationId")
    RakkyCallState.configure(context, base, registration)
    val pending = goAsync()
    Thread {
      try {
        val values = payload.keys().asSequence().associateWith { payload.getString(it) }
        RakkyCallState.receivePush(context.applicationContext, values)
      } finally { Handler(Looper.getMainLooper()).post { pending.finish() } }
    }.start()
  }
}
