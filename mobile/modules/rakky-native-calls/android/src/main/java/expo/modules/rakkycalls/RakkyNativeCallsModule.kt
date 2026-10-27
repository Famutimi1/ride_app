package expo.modules.rakkycalls

import com.google.firebase.messaging.FirebaseMessaging
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class RakkyNativeCallsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RakkyNativeCalls")
    Function("isEnabled") { RakkyCallState.enabled(requireNotNull(appContext.reactContext)) }
    Events("nativeCall")
    OnCreate { RakkyCallState.event = { value -> sendEvent("nativeCall", value) } }
    OnDestroy { RakkyCallState.event = null }
    AsyncFunction("configure") { baseUrl: String, registrationId: String ->
      RakkyCallState.configure(requireNotNull(appContext.reactContext), baseUrl, registrationId)
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    AsyncFunction("getPushToken") { promise: Promise ->
      FirebaseMessaging.getInstance().token.addOnSuccessListener { promise.resolve(it) }
        .addOnFailureListener { promise.reject("token_unavailable", "Unable to register call notifications.", it) }
    }
    AsyncFunction("getPendingEvents") { RakkyCallState.pending(requireNotNull(appContext.reactContext)) }
    AsyncFunction("acknowledgeEvent") { id: String, action: String ->
      val prefs = RakkyCallState.prefs(requireNotNull(appContext.reactContext))
      val raw = prefs.getString("event:$id", null)
      if (raw != null && org.json.JSONObject(raw).optString("action") == action) prefs.edit().remove("event:$id").apply()
    }
    AsyncFunction("reportIncoming") { id: String, tripId: String, deadline: Double ->
      RakkyCallState.incoming(requireNotNull(appContext.reactContext), id, tripId, deadline.toLong())
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    AsyncFunction("updateDeadline") { id: String, deadline: Double ->
      RakkyCallState.update(requireNotNull(appContext.reactContext), id, deadline.toLong())
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    AsyncFunction("startMedia") { id: String, deadline: Double ->
      RakkyCallState.startMedia(requireNotNull(appContext.reactContext), id, deadline.toLong())
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    AsyncFunction("end") { id: String -> RakkyCallState.end(requireNotNull(appContext.reactContext), id) }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    AsyncFunction("clear") { RakkyCallState.clear(requireNotNull(appContext.reactContext)) }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
  }
}
