package il.mesima.app
import java.net.URL
import java.util.concurrent.Executors
object PlaceLookup {
 private val pool=Executors.newFixedThreadPool(3)
 fun search(act:MainActivity,id:String,address:String){pool.execute{
  var text="null";var error=""
  try{
   val u=URL(address);val allowed=mapOf("nominatim.openstreetmap.org" to "/search","photon.komoot.io" to "/api/","overpass-api.de" to "/api/interpreter")
   require(u.protocol=="https"&&u.port in listOf(-1,443)&&allowed[u.host]==u.path&&address.length<8000)
   val c=u.openConnection() as java.net.HttpURLConnection;c.connectTimeout=12000;c.readTimeout=14000;c.instanceFollowRedirects=false
   c.setRequestProperty("User-Agent","Mesima/4.7 Android (personal location reminders)");c.setRequestProperty("Accept","application/json")
   try{require(c.responseCode==200){"שירות החיפוש לא זמין (${c.responseCode})"};val bytes=c.inputStream.use{input->
     val out=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192);var n=input.read(buffer)
     while(n>=0){out.write(buffer,0,n);require(out.size()<=2_000_000);n=input.read(buffer)};out.toByteArray()
    };require(bytes.size<=2_000_000);text=bytes.toString(Charsets.UTF_8)}finally{c.disconnect()}
  }catch(e:Exception){error=e.message?:"חיבור החיפוש נכשל"}
  act.placeResult(id,text,error)
 }}
}
