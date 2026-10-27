package expo.modules.rakkycalls

import android.app.*
import android.content.*
import android.content.pm.ServiceInfo
import android.os.*
import android.view.Gravity
import android.widget.*
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService

class RakkyCallMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    if (message.data["type"] == "rakky_call_invite") RakkyCallState.receivePush(applicationContext, message.data)
    else super.onMessageReceived(message)
  }
  override fun onNewToken(token: String) {
    super.onNewToken(token)
    RakkyCallState.prefs(applicationContext).edit().putString("pushToken", token).apply()
    RakkyCallState.event?.invoke(mapOf("action" to "token"))
  }
}
class RakkyCallActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra("callId") ?: return
    val pending = goAsync()
    RakkyCallState.decline(context, id) { pending.finish() }
    RakkyCallState.queue(context, "end", id); RakkyCallState.end(context, id)
  }
}
class RakkyCallActivity : Activity() {
  override fun onCreate(state: Bundle?) {
    val night = resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK == android.content.res.Configuration.UI_MODE_NIGHT_YES
    setTheme(if (night) android.R.style.Theme_DeviceDefault_NoActionBar else android.R.style.Theme_DeviceDefault_Light_NoActionBar)
    super.onCreate(state)
    if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
    val id = intent.getStringExtra("callId") ?: return finish()
    if (!RakkyCallState.prefs(this).contains("call:$id")) return finish()
    if (intent.action == "ANSWER") { answer(id); return }
    val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setPadding(48, 48, 48, 48) }
    layout.addView(TextView(this).apply { text = "Incoming trip call"; textSize = 28f; gravity = Gravity.CENTER })
    layout.addView(Button(this).apply { text = "Answer"; setOnClickListener { answer(id) } })
    layout.addView(Button(this).apply { text = "Decline"; setOnClickListener { sendBroadcast(Intent(this@RakkyCallActivity, RakkyCallActionReceiver::class.java).putExtra("callId", id)); finish() } })
    setContentView(layout)
  }
  private fun answer(id: String) {
    RakkyCallState.queue(this, "answer", id)
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return finish()
    startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra("rakkyCallId", id))
    finish()
  }
}
class RakkyCallAudioService : Service() {
  override fun onBind(intent: Intent?) = null
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val id = intent?.getStringExtra("callId") ?: return START_NOT_STICKY
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel("trip_audio_active", "Active audio call", NotificationManager.IMPORTANCE_LOW))
    val stop = PendingIntent.getBroadcast(this, id.hashCode(), Intent(this, RakkyCallActionReceiver::class.java).putExtra("callId", id), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val notification = NotificationCompat.Builder(this, "trip_audio_active").setSmallIcon(applicationInfo.icon)
      .setContentTitle("Rakky Ride audio call").setContentText("Call in progress").setOngoing(true)
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, "End call", stop).build()
    try {
      if (Build.VERSION.SDK_INT >= 29) startForeground(4301, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL)
      else startForeground(4301, notification)
    } catch (_: RuntimeException) {
      RakkyCallState.queue(this, "failed", id)
      RakkyCallState.end(this, id)
      stopSelf()
    }
    return START_NOT_STICKY
  }
}
