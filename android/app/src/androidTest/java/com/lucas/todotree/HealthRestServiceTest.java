package com.lucas.todotree;

import static org.junit.Assert.*;
import android.content.*;
import android.os.*;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import java.time.Instant;

@RunWith(AndroidJUnit4.class)
public class HealthRestServiceTest {
  private Context context(){return InstrumentationRegistry.getInstrumentation().getTargetContext();}
  private String shell(String command)throws Exception{ParcelFileDescriptor fd=InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);try(java.io.InputStream in=new ParcelFileDescriptor.AutoCloseInputStream(fd)){return new String(in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);}}
  private JSONObject rest(String id,long ms)throws Exception{
    return new JSONObject().put("id",id).put("version",1).put("deleted_at",JSONObject.NULL).put("body",new JSONObject().put("phase","rest").put("rest",new JSONObject().put("boot",HealthRestReceiver.boot(context())).put("paused",false).put("deadline_mono",SystemClock.elapsedRealtime()+ms)));
  }
  @Test public void pauseOldBootDeletionAndExpiredDeadlinesCannotStartCountdown()throws Exception{
    JSONObject entry=rest("eligibility",1000);assertTrue(HealthRestService.eligible(context(),entry,SystemClock.elapsedRealtime()));
    entry.getJSONObject("body").getJSONObject("rest").put("paused",true);assertFalse(HealthRestService.eligible(context(),entry,SystemClock.elapsedRealtime()));
    entry.getJSONObject("body").getJSONObject("rest").put("paused",false).put("boot","previous-boot");assertFalse(HealthRestService.eligible(context(),entry,SystemClock.elapsedRealtime()));
    entry=rest("eligibility",1000).put("deleted_at","deleted");assertFalse(HealthRestService.eligible(context(),entry,SystemClock.elapsedRealtime()));
    assertFalse(HealthRestService.eligible(context(),rest("expired",-1),SystemClock.elapsedRealtime()));
    assertFalse(HealthRestService.eligible(context(),rest("unbounded",7200000),SystemClock.elapsedRealtime()));
  }
  private void waitForState(String state,long limit)throws Exception{
    long until=SystemClock.elapsedRealtime()+limit;
    try(IntegrationStore store=new IntegrationStore(context())){while(true){JSONObject value=store.diagnostic();if(value!=null&&state.equals(value.optString("state")))return;if(SystemClock.elapsedRealtime()>until)fail("rest test did not reach "+state);SystemClock.sleep(50);}}
  }
  @Test public void consecutiveForegroundCountdownsPostWithScreenOffAndForcedDoze()throws Exception{
    Context c=context();shell("pm grant "+c.getPackageName()+" android.permission.POST_NOTIFICATIONS");
    try(ActivityScenario<MainActivity> activity=ActivityScenario.launch(MainActivity.class);HealthStore store=new HealthStore(c)){
      int before=store.snapshot().getJSONArray("records").length();
      for(int run=0;run<3;run++){
        shell("dumpsys deviceidle unforce");shell("input keyevent 224");shell("wm dismiss-keyguard");
        activity.onActivity(a->androidx.core.content.ContextCompat.startForegroundService(a,new Intent(a,HealthRestService.class).putExtra("test_seconds",3)));
        waitForState("running",5000);shell("input keyevent 223");shell("dumpsys battery unplug");shell("dumpsys deviceidle force-idle");
        waitForState("posted",12000);
        try(IntegrationStore receipt=new IntegrationStore(c)){JSONObject result=receipt.diagnostic();assertTrue(result.getLong("fired_at")-result.getLong("started_at")<10000);assertEquals("confirmed",receipt.confirmDiagnostic(result.getString("id")).getString("state"));}
        long until=SystemClock.elapsedRealtime()+3000;while(HealthRestService.running()&&SystemClock.elapsedRealtime()<until)SystemClock.sleep(50);assertFalse("finished countdown must stop",HealthRestService.running());
      }
      assertEquals("diagnostics cannot invent training facts",before,store.snapshot().getJSONArray("records").length());
    }finally{HealthRestService.stopDiagnostic(c);c.stopService(new Intent(c,HealthRestService.class));shell("dumpsys deviceidle unforce");shell("dumpsys battery reset");shell("input keyevent 224");shell("wm dismiss-keyguard");}
  }
  @Test public void stoppedDiagnosticCannotPostLateOrConfirmDelivery()throws Exception{
    Context c=context();shell("pm grant "+c.getPackageName()+" android.permission.POST_NOTIFICATIONS");
    try(ActivityScenario<MainActivity> activity=ActivityScenario.launch(MainActivity.class)){
      activity.onActivity(a->androidx.core.content.ContextCompat.startForegroundService(a,new Intent(a,HealthRestService.class).putExtra("test_seconds",2)));waitForState("running",5000);
      HealthRestService.stopDiagnostic(c);waitForState("cancelled",3000);SystemClock.sleep(2300);
      try(IntegrationStore store=new IntegrationStore(c)){JSONObject result=store.diagnostic();assertEquals("cancelled",result.getString("state"));try{store.confirmDiagnostic(result.getString("id"));fail("cancelled test cannot confirm");}catch(IllegalStateException expected){}}
    }finally{c.stopService(new Intent(c,HealthRestService.class));}
  }
}
