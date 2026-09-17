package il.mesima.app

import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLDecoder
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Uses Android networking, independent of WebView CORS. The bridge is restricted
 * to the authenticated user's sync files and pointer; backups remain separate. */
object CloudSyncHttp {
 const val MAX=22*1024*1024
 private val pool=Executors.newFixedThreadPool(2)
 class Fault(val code:String):Exception(code)
 data class Request(val uri:URI,val method:String,val headers:Map<String,String>,val body:String)
 private fun decode(s:String)=URLDecoder.decode(s,"UTF-8")
 fun validate(input:JSONObject,project:String,bucket:String,uid:String):Request {
  if(input.optString("expectedUid")!=uid)throw Fault("ACCOUNT_CHANGED")
  val address=input.getString("url");require(address.length<=8000)
  val u=URI(address);require(u.scheme=="https"&&u.port in listOf(-1,443)&&u.rawUserInfo==null&&u.rawFragment==null)
  val method=input.optString("method","GET");val prefix="users/$uid/sync/"
  fun validObject(p:String)=p.startsWith(prefix)&&p.removePrefix(prefix).matches(Regex("[0-9a-f-]{36}\\.json"))
  val query=linkedMapOf<String,String>()
  u.rawQuery?.takeIf{it.isNotEmpty()}?.split('&')?.forEach{pair->
   val parts=pair.split('=',limit=2);val key=decode(parts[0]);require(!query.containsKey(key));query[key]=decode(parts.getOrElse(1){""})
  }
  val body=input.optString("body","");if(body.toByteArray(Charsets.UTF_8).size>MAX)throw Fault("TOO_LARGE")
  when(u.host){
   "firestore.googleapis.com"->{
    require(u.path=="/v1/projects/$project/databases/(default)/documents/users/$uid/sync/state")
    if(method=="GET")require(query.isEmpty())
    else {
     require(method=="PATCH"&&query.size==1&&query.keys.all{it in listOf("currentDocument.updateTime","currentDocument.exists")})
     if(query.containsKey("currentDocument.exists"))require(query["currentDocument.exists"]=="false")
     val fields=JSONObject(body).getJSONObject("fields")
     require(validObject(fields.getJSONObject("path").getString("stringValue"))&&fields.getJSONObject("schema").getString("integerValue")=="1")
    }
   }
   "firebasestorage.googleapis.com"->{
    val base="/v0/b/$bucket/o";val p=u.path
    if(p==base){
     if(method=="POST")require(query.keys==setOf("name")&&validObject(query["name"]?:""))
     else require(method=="GET"&&query.keys.all{it in listOf("prefix","maxResults","pageToken")}&&query["prefix"]==prefix&&query["maxResults"]=="100")
    }else{
     require(p.startsWith("$base/")&&validObject(p.removePrefix("$base/")))
     if(method=="GET")require(query==mapOf("alt" to "media"))
     else require(method=="DELETE"&&query.isEmpty())
    }
   }
   else->throw Fault("INVALID_REQUEST")
  }
  val headers=linkedMapOf<String,String>();val raw=input.optJSONObject("headers")?:JSONObject()
  raw.keys().forEach{k->val value=raw.getString(k);require(k.lowercase() in listOf("content-type","x-goog-upload-protocol")&&!value.contains('\r')&&!value.contains('\n'));headers[k]=value}
  if(method in listOf("GET","DELETE"))require(body.isEmpty())
  return Request(u,method,headers,body)
 }
 fun request(act:MainActivity,id:String,text:String){
  if(!id.matches(Regex("[0-9a-f-]{36}")))return
  pool.execute{
   val result=try{
    if(!CloudBackup.configured(act))throw Fault("AUTH")
    val user=FirebaseAuth.getInstance().currentUser?:throw Fault("AUTH")
    val opts=FirebaseApp.getInstance().options
    val r=validate(JSONObject(text),opts.projectId?:"",opts.storageBucket?:"",user.uid)
    val token=Tasks.await(user.getIdToken(false),10,TimeUnit.SECONDS).token?:throw Fault("AUTH")
    if(FirebaseAuth.getInstance().currentUser?.uid!=user.uid)throw Fault("ACCOUNT_CHANGED")
    execute(r,token)
   }catch(e:Exception){
    val code=when(e){is Fault->e.code;is java.net.SocketTimeoutException,is java.util.concurrent.TimeoutException->"TIMEOUT";is IllegalArgumentException,is org.json.JSONException->"INVALID_REQUEST";else->"NETWORK"}
    JSONObject().put("error",code)
   }
   act.syncResponse(id,result)
  }
 }
 private fun execute(r:Request,token:String):JSONObject {
  val c=r.uri.toURL().openConnection() as HttpURLConnection
  c.connectTimeout=10000;c.readTimeout=20000;c.instanceFollowRedirects=false;c.requestMethod=r.method;c.useCaches=false
  c.setRequestProperty("Authorization",(if(r.uri.host=="firebasestorage.googleapis.com")"Firebase " else "Bearer ")+token)
  r.headers.forEach{(k,v)->c.setRequestProperty(k,v)}
  try{
   if(r.body.isNotEmpty()){val bytes=r.body.toByteArray(Charsets.UTF_8);c.doOutput=true;c.setFixedLengthStreamingMode(bytes.size);c.outputStream.use{it.write(bytes)}}
   val status=c.responseCode;val out=ByteArrayOutputStream()
   (if(status>=400)c.errorStream else c.inputStream)?.use{input->
    val buffer=ByteArray(8192);var count=input.read(buffer)
    while(count>=0){if(out.size()+count>MAX)throw Fault("TOO_LARGE");out.write(buffer,0,count);count=input.read(buffer)}
   }
   return JSONObject().put("status",status).put("body",out.toString("UTF-8"))
  }finally{c.disconnect()}
 }
}
