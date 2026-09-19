package il.mesima.app
import org.junit.Test
import org.junit.Assert.*
import org.json.JSONObject
import org.json.JSONArray
class NativeStateTest {
 @Test fun completedChecklistBlocksOnlyItsCycleAndUndoRestoresFutureAlarms(){
  val cl=JSONObject().put("id","pack").put("cycle","2026-09-17").put("complete",true)
  val task=JSONObject().put("id","project").put("checklists",JSONArray().put(cl))
  val snapshot=JSONObject().put("tasks",JSONArray().put(task))
  val meta=JSONObject().put("taskId","project").put("checklistId","pack").put("occurrence","2026-09-17")
  assertTrue(NativeRepo.blocked(snapshot,JSONArray(),meta))
  meta.put("occurrence","2026-09-18");assertFalse(NativeRepo.blocked(snapshot,JSONArray(),meta))
  cl.put("complete",false);meta.put("occurrence","2026-09-17");assertFalse(NativeRepo.blocked(snapshot,JSONArray(),meta))
  task.put("done",true);assertTrue(NativeRepo.blocked(snapshot,JSONArray(),meta))
 }
 @Test fun aCompletedUnarchivedTaskStillBlocksAllSystemReminders(){
  val t=JSONObject().put("id","once").put("done",true).put("archived",false)
  val s=JSONObject().put("tasks",JSONArray().put(t));val m=JSONObject().put("taskId","once")
  assertTrue(NativeRepo.blocked(s,JSONArray(),m));t.put("done",false);assertFalse(NativeRepo.blocked(s,JSONArray(),m))
 }
 private fun fix(x:Double,t:Long,acc:Double=5.0)=JSONObject().put("lat",32.0).put("lng",x).put("acc",acc).put("t",t)
 @Test fun sameTripSurvivesSerializationAndMissingFixes(){
  val s=TripState.feed(JSONObject(),fix(34.0,1000000))
  TripState.feed(s,fix(34.001,1010000));val start=s.getLong("startedAt");val meters=s.getDouble("meters")
  val restored=JSONObject(s.toString());TripState.feed(restored,fix(34.002,1910000))
  assertEquals(start,restored.getLong("startedAt"));assertEquals(meters,restored.getDouble("meters"),0.1)
  TripState.feed(restored,fix(34.003,1920000));assertTrue(restored.getDouble("meters")>meters)
 }
 @Test fun confirmedStopStartsNewTripAndBadAccuracyDoesNot(){
  val s=TripState.feed(JSONObject(),fix(34.0,1000000));TripState.feed(s,fix(34.001,1010000));val start=s.getLong("startedAt")
  TripState.feed(s,fix(34.1,1020000,400.0));assertEquals(start,s.getLong("startedAt"))
  for(i in 1..181)TripState.feed(s,fix(34.001,1010000+i*10000L))
  TripState.feed(s,fix(34.002,2830000));assertTrue(s.getLong("startedAt")>start)
 }
 @Test fun aDayOfflineExpiresBeforeReceivingAnotherLocation(){
  val s=TripState.feed(JSONObject(),fix(34.0,1000000));TripState.feed(s,fix(34.001,1010000))
  assertFalse(TripState.expire(s,1010000+29*60000));assertTrue(s.getDouble("meters")>0)
  val restored=JSONObject(s.toString());assertTrue(TripState.expire(restored,1010000+86400000))
  assertEquals(0.0,restored.getDouble("meters"),0.001);assertNull(restored.optJSONObject("prev"))
  assertFalse(TripState.expire(restored,1010000+86400001))
  TripState.feed(restored,fix(35.0,1010000+86400010));assertEquals(0.0,restored.getDouble("meters"),0.001)
 }
 @Test fun completionBlocksOnlyThatDayAndPendingCommandIsDurable(){
  val t=JSONObject().put("id","habit").put("daily",true).put("log",JSONObject().put("2026-09-15",1))
  val snap=JSONObject().put("tasks",JSONArray().put(t));val meta=JSONObject().put("taskId","habit").put("day","2026-09-15")
  assertTrue(NativeRepo.blocked(snap,JSONArray(),meta));meta.put("day","2026-09-16");assertFalse(NativeRepo.blocked(snap,JSONArray(),meta))
  val pending=JSONArray().put(JSONObject().put("taskId","habit").put("day","2026-09-16"))
  assertTrue(NativeRepo.blocked(snap,JSONArray(pending.toString()),meta));meta.put("day","2026-09-17");assertFalse(NativeRepo.blocked(snap,pending,meta))
  t.put("archived",true);assertTrue(NativeRepo.blocked(snap,JSONArray(),meta))
 }
}
