package com.lucas.todotree;

import static org.junit.Assert.*;
import android.graphics.Bitmap;
import android.os.SystemClock;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/** Runs the real WebView: checks system insets, overflow, tabs and fixed panels. */
@RunWith(AndroidJUnit4.class)
public class MobileLayoutTest {
    private JSONObject js(ActivityScenario<MainActivity> activity, String script) throws Exception {
        CompletableFuture<String> result = new CompletableFuture<>();
        activity.onActivity(a -> a.getBridge().getWebView().evaluateJavascript(
            "JSON.stringify((()=>{" + script + "})())", result::complete));
        Object value = new JSONTokener(result.get(5, TimeUnit.SECONDS)).nextValue();
        return value instanceof String ? new JSONObject((String)value) : new JSONObject();
    }
    private JSONObject waitFor(ActivityScenario<MainActivity> activity, String selector) throws Exception {
        for (int i=0;i<80;i++) {
            JSONObject state=js(activity,"return {ready:!!document.querySelector('"+selector+"')};");
            if (state.optBoolean("ready")) return state;
            SystemClock.sleep(250);
        }
        throw new AssertionError("WebView did not render " + selector);
    }
    private void screenshot(String name) throws Exception {
        Bitmap bitmap=InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        assertNotNull(bitmap);
        File dir=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getExternalFilesDir(null),"screenshots");
        assertTrue(dir.exists() || dir.mkdirs());
        try(FileOutputStream out=new FileOutputStream(new File(dir,name+".png"))) { bitmap.compress(Bitmap.CompressFormat.PNG,100,out); }
        bitmap.recycle();
    }
    @Test public void todayAndCalendarRespectSafeAreas() throws Exception {
        try(ActivityScenario<MainActivity> activity=ActivityScenario.launch(MainActivity.class)) {
            waitFor(activity,".today-stats");
            SystemClock.sleep(750);
            JSONObject bounds=js(activity,"const h=document.querySelector('.workspace-header').getBoundingClientRect(); const n=document.querySelector('.mobile-navigation').getBoundingClientRect(); const css=getComputedStyle(document.documentElement); const top=parseFloat(css.getPropertyValue('--safe-area-inset-top'))||0; const bottom=parseFloat(css.getPropertyValue('--safe-area-inset-bottom'))||0; const tabs=[...document.querySelectorAll('.today-tabs button')].map(x=>x.getBoundingClientRect()); return {top:h.top,safeTop:top,navBottom:n.bottom,navHeight:n.height,bottom:bottom,height:innerHeight,width:innerWidth,scroll:document.documentElement.scrollWidth,tabsFit:tabs.every(x=>x.left>=0&&x.right<=innerWidth&&x.height>=44)};");
            assertTrue(bounds.toString(),bounds.getDouble("top")>=bounds.getDouble("safeTop")-1);
            assertTrue(bounds.toString(),bounds.getDouble("navBottom")<=bounds.getDouble("height")+1);
            assertTrue(bounds.toString(),bounds.getDouble("navHeight")>=60+bounds.getDouble("bottom")-1);
            assertTrue(bounds.toString(),bounds.getDouble("scroll")<=bounds.getDouble("width")+1);
            assertTrue(bounds.toString(),bounds.getBoolean("tabsFit"));
            screenshot("today");
            js(activity,"document.querySelectorAll('.today-tabs button')[1].click();return {};");
            waitFor(activity,".calendar-day-detail");
            JSONObject calendar=js(activity,"const m=document.querySelector('.calendar-month').getBoundingClientRect();const d=document.querySelector('.calendar-day-detail').getBoundingClientRect();return {stacked:d.top>=m.bottom-1,fits:d.right<=innerWidth+1&&m.right<=innerWidth+1,cells:document.querySelectorAll('.calendar-days>div').length};");
            assertTrue(calendar.toString(),calendar.getBoolean("stacked"));
            assertTrue(calendar.toString(),calendar.getBoolean("fits"));
            assertEquals(42,calendar.getInt("cells"));
            screenshot("calendar");
            js(activity,"document.querySelectorAll('.today-tabs button')[0].click();return {};");
            waitFor(activity,".today-stats");
            js(activity,"document.querySelector('.today-stats>button').click();return {};");
            waitFor(activity,".mobile-full-panel");
            JSONObject panel=js(activity,"const r=document.querySelector('.mobile-full-panel').getBoundingClientRect();const css=getComputedStyle(document.documentElement);return {top:r.top,bottom:r.bottom,safeTop:parseFloat(css.getPropertyValue('--safe-area-inset-top'))||0,safeBottom:parseFloat(css.getPropertyValue('--safe-area-inset-bottom'))||0,height:innerHeight};");
            assertTrue(panel.toString(),panel.getDouble("top")>=panel.getDouble("safeTop")-1);
            assertTrue(panel.toString(),panel.getDouble("bottom")<=panel.getDouble("height")-panel.getDouble("safeBottom")+1);
            screenshot("completed");
        }
    }
}
