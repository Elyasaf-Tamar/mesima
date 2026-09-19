package il.mesima.app

import org.json.JSONObject
import kotlin.math.*

/** Persisted trip accumulator. Brief GPS gaps survive; a 30-minute idle gap expires. */
object TripState {
 const val IDLE_MS=30*60_000L
 fun expire(state:JSONObject,now:Long):Boolean {
  val lastMove=state.optLong("lastMoveAt",state.optLong("startedAt"))
  if(state.optBoolean("idle")||lastMove<=0||now-lastMove<IDLE_MS)return false
  state.put("meters",0).put("startedAt",0).put("stationary",0).put("idle",true)
  state.remove("prev");return true
 }
 fun distance(a:JSONObject,b:JSONObject):Double {
  val r=6371000.0;val la=Math.toRadians(a.optDouble("lat"));val lb=Math.toRadians(b.optDouble("lat"))
  val dl=lb-la;val dn=Math.toRadians(b.optDouble("lng")-a.optDouble("lng"))
  return 2*r*asin(min(1.0,sqrt(sin(dl/2).pow(2)+cos(la)*cos(lb)*sin(dn/2).pow(2))))
 }
 fun feed(state:JSONObject,fix:JSONObject):JSONObject {
  if(fix.optDouble("acc",999.0)>70||fix.optDouble("acc",999.0)<0)return state
  val now=fix.optLong("t")
  val last=state.optJSONObject("last");if(last!=null&&now<=last.optLong("t"))return state
  expire(state,now);val prev=state.optJSONObject("prev")
  if(prev==null){state.put("prev",fix).put("last",fix).put("startedAt",now).put("lastMoveAt",now).put("idle",false).put("meters",0).put("stationary",0);return state}
  val dt=(now-prev.optLong("t"))/1000.0;val d=distance(prev,fix)
  val gap=now-(last?.optLong("t")?:now)
  if(dt>0&&d/dt>250/3.6){state.put("last",fix);return state}
  val threshold=max(20.0,min(60.0,(prev.optDouble("acc",10.0)+fix.optDouble("acc",10.0))/2))
  if(d>=threshold){
   if(gap<=120_000)state.put("meters",state.optDouble("meters",0.0)+d)
   // After a long missing sample we retain the trip ID and re-anchor, without guessing distance.
   state.put("stationary",0).put("lastMoveAt",now).put("prev",fix)
  }else if(gap in 1..90_000){state.put("stationary",state.optLong("stationary")+gap)}
  state.put("last",fix);return state
 }
}
