package il.mesima.app
import org.junit.Test
import org.junit.Assert.*
import org.json.JSONObject
import java.net.URLEncoder
class CloudSyncHttpTest {
 private val file="users/testuser/sync/00000000-0000-0000-0000-000000000000.json"
 private val base="https://firebasestorage.googleapis.com/v0/b/test-bucket/o"
 private val doc="https://firestore.googleapis.com/v1/projects/test-project/databases/(default)/documents/users/testuser/sync/state"
 private fun req(url:String,method:String="GET",body:String="")=JSONObject().put("url",url).put("method",method).put("body",body).put("expectedUid","testuser")
 private fun check(r:JSONObject)=CloudSyncHttp.validate(r,"test-project","test-bucket","testuser")
 private fun rejects(r:JSONObject){try{check(r);fail("Must reject request")}catch(e:Exception){assertTrue(e is IllegalArgumentException||e is CloudSyncHttp.Fault||e is org.json.JSONException)}}
 @Test fun acceptsOnlyOwnSyncDownloadsUploadsAndConditionalCommit(){
  assertEquals("GET",check(req(doc)).method)
  assertEquals("GET",check(req(base+"/"+URLEncoder.encode(file,"UTF-8")+"?alt=media")).method)
  assertEquals("DELETE",check(req(base+"/"+URLEncoder.encode(file,"UTF-8"),"DELETE")).method)
  check(req(base+"?name="+URLEncoder.encode(file,"UTF-8"),"POST","multipart-data"))
  check(req(doc+"?currentDocument.exists=false","PATCH",JSONObject().put("fields",JSONObject().put("path",JSONObject().put("stringValue",file)).put("schema",JSONObject().put("integerValue","1"))).toString()))
 }
 @Test fun rejectsForeignHostsUsersBucketsAndBackups(){
  rejects(req(doc.replace("https:","http:")))
  rejects(req(doc.replace("firestore.googleapis.com","firestore.googleapis.com.example.org")))
  rejects(req(doc.replace("testuser","someone-else")))
  rejects(req(base.replace("test-bucket","foreign-bucket")+"/"+URLEncoder.encode(file,"UTF-8")+"?alt=media"))
  rejects(req(base+"/"+URLEncoder.encode(file.replace("/sync/","/backups/"),"UTF-8")+"?alt=media"))
  rejects(req(doc+"?currentDocument.exists=true","PATCH","{}"))
  rejects(req(doc).put("headers",JSONObject().put("Authorization","caller-token")))
 }
 @Test fun accountSwitchIsRejectedBeforeSending(){
  try{check(req(doc).put("expectedUid","old-account"));fail("account changed")}
  catch(e:CloudSyncHttp.Fault){assertEquals("ACCOUNT_CHANGED",e.code)}
 }
}
