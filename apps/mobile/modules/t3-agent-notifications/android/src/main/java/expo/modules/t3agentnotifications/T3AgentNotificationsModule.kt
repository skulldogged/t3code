package expo.modules.t3agentnotifications

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class T3AgentNotificationsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3AgentNotifications")

    Function("configure") {
        deviceId: String,
        userId: String,
        scheme: String,
        ongoingEnabled: Boolean
      ->
      appContext.reactContext?.let {
        AgentNotifications.configure(it, deviceId, userId, scheme, ongoingEnabled)
      }
    }

    Function("clear") {
      appContext.reactContext?.let { AgentNotifications.clear(it) }
    }

    Function("publishLocalActivity") { title: String, body: String, path: String, active: Boolean ->
      appContext.reactContext?.let {
        AgentNotifications.publishLocalActivity(it, title, body, path, active)
      }
    }

    Function("publishLocalAlert") { title: String, body: String, path: String, id: String ->
      appContext.reactContext?.let { AgentNotifications.publishLocalAlert(it, title, body, path, id) }
    }

    Function("configureLocalActivity") { scheme: String, enabled: Boolean ->
      appContext.reactContext?.let { AgentNotifications.configureLocalActivity(it, scheme, enabled) }
    }
  }
}
