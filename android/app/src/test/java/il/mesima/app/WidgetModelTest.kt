package il.mesima.app
import org.junit.Test
import org.junit.Assert.*
import org.json.JSONObject
import org.json.JSONArray
class WidgetModelTest {
 private fun obj(s:String)=JSONObject(s)
 @Test fun calendarUsesRollingSevenDaysIncludingOverlappingEvents(){
  val days=JSONObject()
  for(d in 18..28)days.put("2026-09-$d",JSONArray().put(obj("""{"id":"e$d","kind":"event","title":"event"}""")))
  days.getJSONArray("2026-09-19").put(obj("""{"id":"overlap","kind":"event","title":"began yesterday"}"""))
  val rows=WidgetModel.rows(JSONObject().put("days",days),JSONArray(),obj("""{"kind":"calendar"}"""),"2026-09-19")
  assertEquals(8,rows.count{it.optString("kind")=="event"});assertTrue(rows.any{it.optString("id")=="overlap"})
  assertFalse(rows.any{it.optString("id") in listOf("e18","e26","e27","e28")})
 }
 @Test fun mixedTasksDeduplicateTodayAndNeverSelectHabitsOrProjects(){
  val s=obj("""{"tasks":[{"id":"a","kind":"short","manualEligible":true},{"id":"b","kind":"short","manualEligible":true},{"id":"h","kind":"short","daily":true},{"id":"p","kind":"long"}],"days":{"2026-09-19":[{"id":"a","kind":"task"},{"id":"h","kind":"task"}]},"widgets":{"7":{"ids":["a","b","h","p"]}}}""")
  val rows=WidgetModel.rows(s,JSONArray(),obj("""{"widgetId":7,"kind":"tasks"}"""),"2026-09-19")
  assertEquals(listOf("a","h","b"),rows.filter{it.optString("kind")=="task"}.map{it.optString("id")})
  val pending=JSONArray().put(obj("""{"taskId":"b","action":"complete"}"""))
  assertFalse(WidgetModel.rows(s,pending,obj("""{"widgetId":7,"kind":"tasks"}"""),"2026-09-19").any{it.optString("id")=="b"})
 }
 @Test fun openChecklistCarriesAcrossMidnightAndCompletedCycleReturnsOnlyWhenNextOpens(){
  val s=obj("""{"widgetChecklists":[{"id":"cl","title":"pack","cycle":"2026-09-18","complete":false,"slots":[{"day":"2026-09-20","resetAt":9000}]}]}""")
  val c=obj("""{"kind":"tasks"}""")
  assertTrue(WidgetModel.rows(s,JSONArray(),c,"2026-09-19",1000).any{it.optString("id")=="cl"})
  s.getJSONArray("widgetChecklists").getJSONObject(0).put("complete",true)
  assertFalse(WidgetModel.rows(s,JSONArray(),c,"2026-09-19",1000).any{it.optString("id")=="cl"})
  assertTrue(WidgetModel.rows(s,JSONArray(),c,"2026-09-20",10000).any{it.optString("id")=="cl"})
 }
 @Test fun twoShoppingWidgetsHaveIndependentListsAndDurableIdempotentChecks(){
  val s=obj("""{"widgets":{"1":{"id":"L1","items":[{"id":"i","title":"milk","done":false}]},"2":{"id":"L2","items":[{"id":"j","title":"bread","done":false}]}}}""")
  val p=JSONArray().put(obj("""{"action":"shopping","listId":"L1","itemId":"i","done":true}"""))
  fun rows(id:Int)=WidgetModel.rows(s,p,obj("""{"kind":"shopping","widgetId":$id,"contentId":"L$id"}"""),"2026-09-19")
  assertTrue(rows(1)[0].getBoolean("done"));assertFalse(rows(2)[0].getBoolean("done"))
  p.put(obj("""{"action":"shopping","listId":"L1","itemId":"i","done":false}"""));assertFalse(rows(1)[0].getBoolean("done"))
 }
 @Test fun notePreviewMustBeOptedIn(){
  val s=obj("""{"widgets":{"1":{"id":"n","text":"private content","preview":false}}}""")
  val c=obj("""{"kind":"notes","widgetId":1,"contentId":"n","preview":true}""")
  assertFalse(WidgetModel.rows(s,JSONArray(),c,"2026-09-19")[0].getString("title").contains("private"))
  s.getJSONObject("widgets").getJSONObject("1").put("preview",true)
  assertEquals("private content",WidgetModel.rows(s,JSONArray(),c,"2026-09-19")[0].getString("title"))
  c.put("preview",false);assertFalse(WidgetModel.rows(s,JSONArray(),c,"2026-09-19")[0].getString("title").contains("private"))
  c.put("contentId","other");assertTrue(WidgetModel.rows(s,JSONArray(),c,"2026-09-19").isEmpty())
 }
}
