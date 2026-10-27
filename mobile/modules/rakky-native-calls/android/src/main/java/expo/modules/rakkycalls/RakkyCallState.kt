package expo.modules.rakkycalls

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.os.*
import android.telecom.DisconnectCause
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import com.facebook.react.bridge.Arguments
import io.wazo.callkeep.Constants
import io.wazo.callkeep.RNCallKeepModule
import io.wazo.callkeep.VoiceConnectionService
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

internal object RakkyCallState {
  private const val CHANNEL = "trip_calls"
  private val main = Handler(Looper.getMainLooper())
  private val io = Executors.newFixedThreadPool(2)
  private var initialized = false
  private val timerCalls = mutableSetOf<String>()
  private var wakeLock: PowerManager.WakeLock? = null
  var event: ((Map<String, Any?>) -> Unit)? = null
  fun enabled(context: Context) = Build.VERSION.SDK_INT >= 26 && runCatching { context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA).metaData.getBoolean("com.rackyride.NATIVE_CALLS_ENABLED", false) }.getOrDefault(false)
  fun prefs(context: Context) = context.getSharedPreferences("rakky-native-calls", Context.MODE_PRIVATE)
  fun initialize(context: Context) {
    if (initialized) return
    initialized = true
    if (Build.VERSION.SDK_INT < 26) return
    val manager = context.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel(CHANNEL, "Trip calls", NotificationManager.IMPORTANCE_HIGH).apply { description = "Incoming trip audio calls" })
    val options = Arguments.createMap().apply {
      putBoolean("selfManaged", true)
      putMap("foregroundService", Arguments.createMap().apply {
        putString("channelId", "trip_call_active"); putString("channelName", "Active trip call")
        putString("notificationTitle", "Rakky Ride audio call"); putInt("foregroundServiceType", android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL)
      })
    }
    RNCallKeepModule.setupNative(context, options)
    val filter = IntentFilter().apply {
      addAction(Constants.ACTION_SHOW_INCOMING_CALL_UI); addAction(Constants.ACTION_ANSWER_CALL)
      addAction(Constants.ACTION_END_CALL); addAction(Constants.ACTION_ON_CREATE_CONNECTION_FAILED)
    }
    LocalBroadcastManager.getInstance(context).registerReceiver(object : BroadcastReceiver() {
      override fun onReceive(ctx: Context, intent: Intent) {
        @Suppress("DEPRECATION", "UNCHECKED_CAST")
        val values = intent.getSerializableExtra("attributeMap") as? HashMap<String, String> ?: return
        val id = values[Constants.EXTRA_CALL_UUID] ?: return
        when (intent.action) {
          Constants.ACTION_SHOW_INCOMING_CALL_UI -> showNotification(ctx, id)
          Constants.ACTION_ANSWER_CALL -> queue(ctx, "answer", id)
          Constants.ACTION_END_CALL -> ctx.sendBroadcast(Intent(ctx, RakkyCallActionReceiver::class.java).putExtra("callId", id))
          Constants.ACTION_ON_CREATE_CONNECTION_FAILED -> { queue(ctx, "failed", id); end(ctx, id) }
        }
      }
    }, filter)
  }
  fun configure(context: Context, baseUrl: String, registrationId: String) {
    check(enabled(context))
    require(baseUrl.startsWith("https://") || (context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0 && baseUrl.startsWith("http://")))
    prefs(context).edit().putString("baseUrl", baseUrl.trimEnd('/')).putString("registrationId", registrationId).apply()
    initialize(context)
  }
  fun queue(context: Context, action: String, id: String) {
    val value = JSONObject().put("action", action).put("callId", id).put("createdAt", System.currentTimeMillis())
    prefs(context).edit().putString("event:$id", value.toString()).apply()
    event?.invoke(mapOf("action" to action, "callId" to id, "createdAt" to System.currentTimeMillis()))
  }
  fun pending(context: Context): List<Map<String, Any?>> = prefs(context).all.filterKeys { it.startsWith("event:") }.values.mapNotNull {
    runCatching { val value = JSONObject(it as String); mapOf("action" to value.getString("action"), "callId" to value.getString("callId"), "createdAt" to value.getLong("createdAt")) }.getOrNull()
  }
  fun incoming(context: Context, id: String, tripId: String, expiry: Long, ticket: String = "") {
    UUID.fromString(id)
    if (expiry <= System.currentTimeMillis() || expiry > System.currentTimeMillis() + 60000) return
    val key = "call:$id"
    val old = prefs(context).getString(key, null)
    if (old != null) {
      if (ticket.isNotEmpty()) prefs(context).edit().putString(key, JSONObject(old).put("ticket", ticket).toString()).apply()
      return
    }
    val value = JSONObject().put("callId", id).put("tripId", tripId).put("deadline", expiry).put("ticket", ticket)
    prefs(context).edit().putString(key, value.toString()).apply()
    initialize(context)
    runCatching { RNCallKeepModule.displayIncomingCall(context, id, id, "Trip participant", false) }
      .onFailure { end(context, id) }
    armWatchdog(context, id)
    queue(context, "incoming", id)
  }
  fun receivePush(context: Context, data: Map<String, String>) {
    if (!enabled(context)) return
    val id = data["callId"] ?: return
    val trip = data["tripId"] ?: return
    val ticket = data["ticket"] ?: return
    val expiry = data["expiresAt"]?.toLongOrNull() ?: return
    if (data["registrationId"] != prefs(context).getString("registrationId", null)) return
    // Firebase invokes this on its service worker. Finish the bounded validation
    // while that service still owns its processing window, before returning.
    if (!status(context, ticket)) return
    val reported = CountDownLatch(1)
    main.post { try { incoming(context, id, trip, expiry, ticket) } finally { reported.countDown() } }
    reported.await(2, TimeUnit.SECONDS)
  }
  private fun status(context: Context, ticket: String): Boolean = request(context, "invite-status", ticket)?.optBoolean("authorized") == true
  private fun request(context: Context, action: String, ticket: String): JSONObject? {
    val base = prefs(context).getString("baseUrl", null) ?: return null
    var connection: HttpURLConnection? = null
    return runCatching {
      connection = (URL("$base/api/calls/$action").openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"; connectTimeout = 2000; readTimeout = 2000; doOutput = true
        setRequestProperty("Content-Type", "application/json")
      }
      connection!!.outputStream.use { it.write(JSONObject().put("ticket", ticket).toString().toByteArray()) }
      if (connection!!.responseCode != 200) return@runCatching null
      connection!!.inputStream.bufferedReader().use { JSONObject(it.readText().take(2048)) }
    }.getOrNull().also { connection?.disconnect() }
  }
  fun decline(context: Context, id: String, completion: (() -> Unit)? = null) {
    val value = prefs(context).getString("call:$id", null)
    if (value == null) { completion?.invoke(); return }
    val ticket = runCatching { JSONObject(value).optString("ticket") }.getOrNull().orEmpty()
    if (ticket.isEmpty()) { completion?.invoke(); return }
    io.execute { try { request(context, "native-decline", ticket) } finally { completion?.invoke() } }
  }
  fun update(context: Context, id: String, expiry: Long) {
    val value = prefs(context).getString("call:$id", null)?.let { JSONObject(it) } ?: JSONObject().put("callId", id)
    value.put("deadline", minOf(expiry, System.currentTimeMillis() + 60000))
    prefs(context).edit().putString("call:$id", value.toString()).apply()
    wakeLock?.acquire(60000)
    armWatchdog(context, id)
  }
  private fun armWatchdog(context: Context, id: String) {
    if (!timerCalls.add(id)) return
    main.post(object : Runnable {
      override fun run() {
        val raw = prefs(context).getString("call:$id", null)
        if (raw == null) { timerCalls.remove(id); return }
        val deadline = runCatching { JSONObject(raw).getLong("deadline") }.getOrDefault(0)
        if (deadline <= System.currentTimeMillis()) { end(context, id); queue(context, "expired", id); timerCalls.remove(id); return }
        event?.invoke(mapOf("action" to "pulse", "callId" to id))
        main.postDelayed(this, 5000)
      }
    })
  }
  fun startMedia(context: Context, id: String, deadline: Long) {
    check(ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
    update(context, id, deadline)
    context.getSystemService(NotificationManager::class.java).cancel(id.hashCode())
    ContextCompat.startForegroundService(context, Intent(context, RakkyCallAudioService::class.java).putExtra("callId", id))
    if (wakeLock?.isHeld != true) wakeLock = (context.getSystemService(Context.POWER_SERVICE) as PowerManager)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "rakky:trip-audio").apply { setReferenceCounted(false); acquire(60000) }
  }
  fun end(context: Context, id: String) {
    prefs(context).edit().remove("call:$id").apply()
    context.getSystemService(NotificationManager::class.java).cancel(id.hashCode())
    VoiceConnectionService.getConnection(id)?.let { connection ->
      connection.setDisconnected(DisconnectCause(DisconnectCause.LOCAL)); connection.destroy(); VoiceConnectionService.deinitConnection(id)
    }
    if (prefs(context).all.keys.none { it.startsWith("call:") }) {
      context.stopService(Intent(context, RakkyCallAudioService::class.java))
      if (wakeLock?.isHeld == true) wakeLock?.release(); wakeLock = null
    }
  }
  fun clear(context: Context) {
    prefs(context).all.keys.filter { it.startsWith("call:") }.forEach { end(context, it.removePrefix("call:")) }
    prefs(context).edit().remove("registrationId").remove("baseUrl").apply()
    prefs(context).all.keys.filter { it.startsWith("event:") }.forEach { prefs(context).edit().remove(it).apply() }
  }
  fun showNotification(context: Context, id: String) {
    val raw = prefs(context).getString("call:$id", null) ?: return
    val deadline = JSONObject(raw).optLong("deadline")
    if (deadline <= System.currentTimeMillis()) { end(context, id); return }
    fun activity(action: String): PendingIntent = PendingIntent.getActivity(context, "$id:$action".hashCode(), Intent(context, RakkyCallActivity::class.java).setAction(action).putExtra("callId", id), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val decline = PendingIntent.getBroadcast(context, id.hashCode(), Intent(context, RakkyCallActionReceiver::class.java).putExtra("callId", id), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val notification = NotificationCompat.Builder(context, CHANNEL).setSmallIcon(context.applicationInfo.icon)
      .setContentTitle("Trip participant").setContentText("Incoming audio call").setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX).setOngoing(true).setTimeoutAfter(deadline - System.currentTimeMillis())
      .setContentIntent(activity("OPEN"))
      .setStyle(NotificationCompat.CallStyle.forIncomingCall(Person.Builder().setName("Trip participant").setImportant(true).build(), decline, activity("ANSWER")))
    val manager = context.getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT < 34 || manager.canUseFullScreenIntent()) notification.setFullScreenIntent(activity("OPEN"), true)
    manager.notify(id.hashCode(), notification.build())
  }
}
