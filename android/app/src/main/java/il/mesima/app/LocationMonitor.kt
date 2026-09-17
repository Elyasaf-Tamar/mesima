package il.mesima.app

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.os.*
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.*
import org.json.JSONObject

class LocationMonitor:Service(){
 companion object {
  @Volatile var running=false
  fun state(c:Context)=runCatching{JSONObject(NativeRepo.prefs(c).getString("location","{}")!!)}.getOrDefault(JSONObject()).put("running",running)
  fun reconcile(c:Context){
   val s=NativeRepo.snapshot(c);val needed=s.optBoolean("geo")&&NativeRepo.objects(s.optJSONArray("tasks")?:org.json.JSONArray()).any{!it.optBoolean("archived")&&!it.optBoolean("done")&&it.optJSONObject("reminder")?.optString("type") in listOf("trip","place")}
   if(!needed){c.stopService(Intent(c,LocationMonitor::class.java));return}
   if(ContextCompat.checkSelfPermission(c,Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED)return
   if(!running)try{ContextCompat.startForegroundService(c,Intent(c,LocationMonitor::class.java))}catch(e:Exception){NativeRepo.prefs(c).edit().putString("locationError","פתח את האפליקציה כדי להפעיל מעקב מיקום").apply()}
  }
 }
 private lateinit var client:FusedLocationProviderClient
 private val callback=object:LocationCallback(){override fun onLocationResult(result:LocationResult){result.locations.forEach{loc->
  val now=System.currentTimeMillis();if(now-loc.time>120_000)return@forEach
  val fix=JSONObject().put("lat",loc.latitude).put("lng",loc.longitude).put("acc",loc.accuracy.toDouble()).put("t",loc.time)
  val s=state(this@LocationMonitor);val trip=TripState.feed(s.optJSONObject("trip")?:JSONObject(),fix);s.put("trip",trip)
  NativeRepo.prefs(this@LocationMonitor).edit().putString("location",s.toString()).commit()
  checkTasks(trip,fix)
 }}}
 override fun onBind(i:Intent?)=null
 override fun onStartCommand(i:Intent?,flags:Int,startId:Int):Int {
  if(running)return START_STICKY
  val manager=getSystemService(NotificationManager::class.java)
  if(Build.VERSION.SDK_INT>=26)manager.createNotificationChannel(NotificationChannel("mesima.location","מעקב מיקום",NotificationManager.IMPORTANCE_LOW))
  val pi=PendingIntent.getActivity(this,770,Intent(this,MainActivity::class.java),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  val n=NotificationCompat.Builder(this,"mesima.location").setSmallIcon(R.drawable.ic_pin).setContentTitle("תזכורות מיקום ונסיעה פעילות").setContentText("משימה ממשיכה לעקוב גם כשהמסך סגור").setContentIntent(pi).setOngoing(true).setSilent(true).build()
  try{
   startForeground(770,n);client=LocationServices.getFusedLocationProviderClient(this)
   val request=LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY,10_000).setMinUpdateIntervalMillis(5_000).setMaxUpdateDelayMillis(20_000).build()
   client.requestLocationUpdates(request,callback,Looper.getMainLooper());running=true
   NativeRepo.prefs(this).edit().remove("locationError").apply()
  }catch(e:Exception){NativeRepo.prefs(this).edit().putString("locationError","נדרשת הרשאת מיקום מדויק").apply();stopSelf();return START_NOT_STICKY}
  return START_STICKY
 }
 private fun checkTasks(trip:JSONObject,fix:JSONObject){
  val s=NativeRepo.snapshot(this);if(!s.optBoolean("geo")){stopSelf();return}
  val ledger=runCatching{JSONObject(NativeRepo.prefs(this).getString("locationLedger","{}")!!)}.getOrDefault(JSONObject())
  NativeRepo.objects(s.optJSONArray("tasks")?:org.json.JSONArray()).forEach{t->
   if(t.optBoolean("archived"))return@forEach
   val r=t.optJSONObject("reminder")?:return@forEach;val id=t.optString("id");val meta=JSONObject().put("taskId",id).put("day",NativeRepo.today()).put("kind","task")
   if(NativeRepo.blocked(this,meta))return@forEach
   if(r.optString("type")=="trip"){
    val key=trip.optLong("startedAt").toString()
    if(trip.optDouble("meters",0.0)>=r.optDouble("km",Double.POSITIVE_INFINITY)*1000&&ledger.optString(id)!=key){
     ledger.put(id,key);NativeRepo.prefs(this).edit().putString("locationLedger",ledger.toString()).commit()
     Notif.show(this,"trip_$id",t.optString("title"),t.optString("note").ifBlank{"תזכורת בתחילת הנסיעה"},meta)
    }
   }
  }
  // Place detection shares the same persistent visit ledger with geofence broadcasts.
  if(fix.optDouble("acc",999.0)<=70)NativeRepo.objects(Fences.load(this)).forEach{f->
   val d=TripState.distance(f,fix);val radius=maxOf(140.0,f.optDouble("radius",250.0))
   if(d>radius+maxOf(70.0,fix.optDouble("acc")))PlaceVisits.exit(this,f.optString("id"))
   else if(d+fix.optDouble("acc")<radius)PlaceVisits.enter(this,f,false)
  }
 }
 override fun onDestroy(){if(::client.isInitialized)client.removeLocationUpdates(callback);running=false;super.onDestroy()}
}

object PlaceVisits {
 private fun pref(c:Context)=c.getSharedPreferences("mesima_visits",Context.MODE_PRIVATE)
 @Synchronized fun exit(c:Context,id:String){pref(c).edit().remove(id).apply()}
 @Synchronized fun enter(c:Context,m:JSONObject,dwell:Boolean){
  if(!NativeRepo.snapshot(c).optBoolean("geo",true))return
  val key=m.optString("id");val now=System.currentTimeMillis()
  val state=runCatching{JSONObject(pref(c).getString(key,"{}")!!)}.getOrDefault(JSONObject())
  if(!state.has("arrived"))state.put("arrived",if(dwell)now-m.optLong("delayMin")*60000 else now)
  val sent=state.optJSONObject("sent")?:JSONObject();state.put("sent",sent)
  if(now-state.optLong("arrived")>=m.optLong("delayMin")*60000){
   NativeRepo.objects(m.optJSONArray("items")?:org.json.JSONArray()).forEach{item->
    val id=item.optString("taskId");val meta=JSONObject(item.toString()).put("day",NativeRepo.today()).put("kind","task")
    if(!sent.optBoolean(id)&&!NativeRepo.blocked(c,meta)){
     sent.put(id,true);pref(c).edit().putString(key,state.toString()).commit()
     Notif.show(c,"loc_$id",item.optString("title"),item.optString("note").ifBlank{"הגעת ל"+m.optString("place")},meta)
    }
   }
  }
  pref(c).edit().putString(key,state.toString()).apply()
 }
}
