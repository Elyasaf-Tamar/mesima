package il.mesima.app

import org.json.JSONObject
import kotlin.math.*

/** Pure, persisted trip accumulator. Gaps in GPS are not evidence of a stop. */
object TripState {
 fun distance(a:JSONObject,b:JSONObject):Double {
  val r=6371000.0;val la=Math.toRadians(a.optDouble("lat"));val lb=Math.toRadians(b.optDouble("lat"))
  val dl=lb-la;val dn=Math.toRadians(b.optDouble("lng")-a.optDouble("lng"))
  return 2*r*asin(min(1.0,sqrt(sin(dl/2).pow(2)+cos(la)*cos(lb)*sin(dn/2).pow(2))))
 }
 fun feed(state:JSONObject,fix:JSONObject):JSONObject {
  if(fix.optDouble("acc",999.0)>70||fix.optDouble("acc",999.0)<0)return state
  val now=fix.optLong("t");val prev=state.optJSONObject("prev")
  val last=state.optJSONObject("last");if(last!=null&&now<=last.optLong("t"))return state
  if(prev==null){state.put("prev",fix).put("last",fix).put("startedAt",now).put("meters",0).put("stationary",0);return state}
  val dt=(now-prev.optLong("t"))/1000.0;val d=distance(prev,fix)
  val gap=now-(last?.optLong("t")?:now)
  if(dt>0&&d/dt>250/3.6){state.put("last",fix);return state}
  val threshold=max(20.0,min(60.0,(prev.optDouble("acc",10.0)+fix.optDouble("acc",10.0))/2))
  if(d>=threshold){
   if(state.optLong("stationary")>=6*60_000){state.put("meters",0).put("startedAt",now)}
   else if(gap<=120_000)state.put("meters",state.optDouble("meters",0.0)+d)
   // After a long missing sample we retain the trip ID and re-anchor, without guessing distance.
   state.put("stationary",0).put("lastMoveAt",now).put("prev",fix)
  }else if(gap in 1..90_000){state.put("stationary",state.optLong("stationary")+gap)}
  state.put("last",fix);return state
 }
}
