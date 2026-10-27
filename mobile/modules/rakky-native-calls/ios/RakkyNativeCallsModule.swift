import ExpoModulesCore
import PushKit
import CallKit
import AVFoundation
import RNCallKeep

final class RakkyCalls: NSObject, PKPushRegistryDelegate, CXCallObserverDelegate {
  static let shared = RakkyCalls()
  static var enabled: Bool { Bundle.main.object(forInfoDictionaryKey: "RakkyNativeCallsEnabled") as? Bool == true }
  private let defaults = UserDefaults.standard
  private let observer = CXCallObserver()
  private var registry: PKPushRegistry?
  private var timer: Timer?
  private var deadlines: [String: Double] = [:]
  var emit: (([String: Any]) -> Void)?
  var token: String? { defaults.string(forKey: "rakky.calls.token") }

  func start() {
    guard Self.enabled, registry == nil else { return }
    RNCallKeep.setup(["appName": "Rakky Ride", "supportsVideo": false, "maximumCallGroups": "1", "maximumCallsPerCallGroup": "1", "includesCallsInRecents": false])
    observer.setDelegate(self, queue: .main)
    let push = PKPushRegistry(queue: .main)
    push.delegate = self
    push.desiredPushTypes = [.voIP]
    registry = push
    timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.tick() }
  }
  func configure(_ baseURL: String, _ registration: String) {
    guard let url = URL(string: baseURL), url.scheme == "https" || (url.scheme == "http" && _isDebugAssertConfiguration()) else { return }
    defaults.set(baseURL, forKey: "rakky.calls.base")
    defaults.set(registration, forKey: "rakky.calls.registration")
    start()
  }
  func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    guard type == .voIP else { return }
    defaults.set(pushCredentials.token.map { String(format: "%02x", $0) }.joined(), forKey: "rakky.calls.token")
    emit?(["action": "token"])
  }
  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    defaults.removeObject(forKey: "rakky.calls.token")
    emit?(["action": "tokenInvalidated"])
  }
  func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
    let data = payload.dictionaryPayload
    guard type == .voIP, let id = data["callId"] as? String, UUID(uuidString: id) != nil else { completion(); return }
    let alreadyReported = observer.calls.contains { $0.uuid.uuidString.lowercased() == id.lowercased() && !$0.hasEnded }
    let expires = Double(data["expiresAt"] as? String ?? "0") ?? 0
    let ticket = data["ticket"] as? String ?? ""
    if !alreadyReported {
      defaults.set(ticket, forKey: "rakky.calls.ticket.\(id)")
      deadlines[id] = min(expires, Date().timeIntervalSince1970 * 1000 + 60000)
    }
    // Every genuine VoIP invite is reported natively before any HTTP request or
    // JavaScript dependency. A duplicate UUID cannot create a second call.
    report(id, fromPush: true) {
      completion()
      if alreadyReported { return }
      guard data["registrationId"] as? String == self.defaults.string(forKey: "rakky.calls.registration"), expires > Date().timeIntervalSince1970 * 1000 else { self.end(id); return }
      self.request("invite-status", ticket: ticket) { response in
        DispatchQueue.main.async {
          if response?["authorized"] as? Bool == true { self.queue("incoming", id: id) } else { self.end(id) }
        }
      }
    }
  }
  func report(_ id: String, fromPush: Bool = false, completion: @escaping () -> Void = {}) {
    RNCallKeep.reportNewIncomingCall(id, handle: id, handleType: "generic", hasVideo: false, localizedCallerName: "Trip participant", supportsHolding: false, supportsDTMF: false, supportsGrouping: false, supportsUngrouping: false, fromPushKit: fromPush, payload: nil, withCompletionHandler: completion)
  }
  func incoming(_ id: String, deadline: Double) {
    guard !observer.calls.contains(where: { $0.uuid.uuidString.lowercased() == id.lowercased() && !$0.hasEnded }) else { return }
    update(id, deadline: deadline)
    report(id)
  }
  func update(_ id: String, deadline: Double) { deadlines[id] = min(deadline, Date().timeIntervalSince1970 * 1000 + 60000) }
  func end(_ id: String) {
    deadlines.removeValue(forKey: id)
    defaults.removeObject(forKey: "rakky.calls.ticket.\(id)")
    RNCallKeep.endCall(withUUID: id, reason: 2)
    if deadlines.isEmpty { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
  }
  private func tick() {
    for (id, deadline) in deadlines {
      if deadline <= Date().timeIntervalSince1970 * 1000 { end(id); queue("expired", id: id) }
      else { emit?(["action": "pulse", "callId": id]) }
    }
  }
  func callObserver(_ callObserver: CXCallObserver, callChanged call: CXCall) {
    guard call.hasEnded else { return }
    let id = call.uuid.uuidString.lowercased()
    let ticket = defaults.string(forKey: "rakky.calls.ticket.\(id)") ?? ""
    if !ticket.isEmpty { request("native-decline", ticket: ticket) { _ in } }
    deadlines.removeValue(forKey: id)
    defaults.removeObject(forKey: "rakky.calls.ticket.\(id)")
  }
  private func request(_ action: String, ticket: String, completion: @escaping ([String: Any]?) -> Void) {
    guard let base = defaults.string(forKey: "rakky.calls.base"), let url = URL(string: "\(base)/api/calls/\(action)") else { completion(nil); return }
    var request = URLRequest(url: url, timeoutInterval: 3)
    request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: ["ticket": ticket])
    URLSession.shared.dataTask(with: request) { data, response, _ in
      guard let http = response as? HTTPURLResponse, http.statusCode == 200, let data, data.count < 4096,
        let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { completion(nil); return }
      completion(value)
    }.resume()
  }
  func queue(_ action: String, id: String) {
    let value: [String: Any] = ["action": action, "callId": id, "createdAt": Date().timeIntervalSince1970 * 1000]
    defaults.set(value, forKey: "rakky.calls.event.\(id)")
    emit?(value)
  }
  func pending() -> [[String: Any]] { defaults.dictionaryRepresentation().filter { $0.key.hasPrefix("rakky.calls.event.") }.values.compactMap { $0 as? [String: Any] } }
  func acknowledge(_ id: String, action: String) {
    if defaults.dictionary(forKey: "rakky.calls.event.\(id)")?["action"] as? String == action { defaults.removeObject(forKey: "rakky.calls.event.\(id)") }
  }
  func clear() {
    for id in Array(deadlines.keys) { end(id) }
    for key in defaults.dictionaryRepresentation().keys where key.hasPrefix("rakky.calls.event.") { defaults.removeObject(forKey: key) }
    defaults.removeObject(forKey: "rakky.calls.registration"); defaults.removeObject(forKey: "rakky.calls.base")
  }
}

public final class RakkyCallsAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    RakkyCalls.shared.start()
    return true
  }
}
public final class RakkyNativeCallsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RakkyNativeCalls")
    Events("nativeCall")
    Function("isEnabled") { RakkyCalls.enabled }
    OnCreate { RakkyCalls.shared.emit = { [weak self] value in self?.sendEvent("nativeCall", value) } }
    OnDestroy { RakkyCalls.shared.emit = nil }
    AsyncFunction("configure") { (base: String, registration: String) in RakkyCalls.shared.configure(base, registration) }.runOnQueue(.main)
    AsyncFunction("getPushToken") { RakkyCalls.shared.token }
    AsyncFunction("getPendingEvents") { RakkyCalls.shared.pending() }
    AsyncFunction("acknowledgeEvent") { (id: String, action: String) in RakkyCalls.shared.acknowledge(id, action: action) }
    AsyncFunction("reportIncoming") { (id: String, _: String, deadline: Double) in RakkyCalls.shared.incoming(id, deadline: deadline) }.runOnQueue(.main)
    AsyncFunction("updateDeadline") { (id: String, deadline: Double) in RakkyCalls.shared.update(id, deadline: deadline) }.runOnQueue(.main)
    AsyncFunction("startMedia") { (id: String, deadline: Double) in RakkyCalls.shared.update(id, deadline: deadline) }.runOnQueue(.main)
    AsyncFunction("end") { (id: String) in RakkyCalls.shared.end(id) }.runOnQueue(.main)
    AsyncFunction("clear") { RakkyCalls.shared.clear() }.runOnQueue(.main)
  }
}
