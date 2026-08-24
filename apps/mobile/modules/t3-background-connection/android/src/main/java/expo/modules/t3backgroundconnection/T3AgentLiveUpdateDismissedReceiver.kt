package expo.modules.t3backgroundconnection

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class T3AgentLiveUpdateDismissedReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val activityKey = intent?.getStringExtra(T3AgentLiveUpdate.ACTIVITY_KEY_EXTRA) ?: return
    T3AgentLiveUpdate.markDismissed(context, activityKey)
  }
}
