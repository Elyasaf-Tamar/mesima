package il.mesima.app
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent
class GeofenceReceiver:BroadcastReceiver(){
 override fun onReceive(ctx:Context,intent:Intent){
  val ev=GeofencingEvent.fromIntent(intent)?:return;if(ev.hasError())return
  ev.triggeringGeofences?.forEach{g->
   val m=Fences.meta(ctx,g.requestId)?:return@forEach
   when(ev.geofenceTransition){
    Geofence.GEOFENCE_TRANSITION_EXIT->PlaceVisits.exit(ctx,g.requestId)
    Geofence.GEOFENCE_TRANSITION_DWELL->PlaceVisits.enter(ctx,m,true)
    Geofence.GEOFENCE_TRANSITION_ENTER->PlaceVisits.enter(ctx,m,false)
   }
  }
 }
}
