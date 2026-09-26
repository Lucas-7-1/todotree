package com.lucas.todotree;

import static org.junit.Assert.*;
import android.graphics.Bitmap;
import android.os.SystemClock;
import android.os.ParcelFileDescriptor;
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
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
        SystemClock.sleep(1200); // Wait for the WebView compositor after DOM assertions.
        Bitmap bitmap=InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        assertNotNull(bitmap);
        File dir=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getExternalFilesDir(null),"screenshots");
        assertTrue(dir.exists() || dir.mkdirs());
        try(FileOutputStream out=new FileOutputStream(new File(dir,name+".png"))) { bitmap.compress(Bitmap.CompressFormat.PNG,100,out); }
        bitmap.recycle();
        // Gradle uninstalls the app after connected tests, deleting its external files.
        // Export test-only captures with the instrumentation shell before that cleanup.
        String source=new File(dir,name+".png").getAbsolutePath();
        // UiAutomation uses Runtime.exec(String), not a shell parser. Run commands
        // separately so quoting and && cannot silently turn into mkdir arguments.
        String destination="/sdcard/Download/todotree-ui/"+name+".png";
        shell("mkdir -p /sdcard/Download/todotree-ui");
        shell("cp "+source+" "+destination);
        String size=shell("stat -c %s "+destination).trim();
        assertTrue("Screenshot export missing: "+name+" "+size,size.matches("[1-9][0-9]*"));
    }
    private String shell(String command) throws Exception {
        ParcelFileDescriptor pipe=InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);
        try(ParcelFileDescriptor.AutoCloseInputStream stream=new ParcelFileDescriptor.AutoCloseInputStream(pipe)) {
            java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream();
            byte[] buffer=new byte[1024];int count;
            while((count=stream.read(buffer))!=-1) output.write(buffer,0,count);
            return output.toString("UTF-8");
        }
    }

    private void seed() throws Exception {
        NativeWorkspaceTest helper=new NativeWorkspaceTest();
        NativeWorkspacePlugin plugin=helper.plugin(InstrumentationRegistry.getInstrumentation().getTargetContext());
        com.getcapacitor.JSObject state=helper.read(plugin);
        org.json.JSONArray changes=new org.json.JSONArray();
        String today=java.time.LocalDate.now(java.time.ZoneId.of("Asia/Shanghai")).toString();
        String[] titles={"贵州行","出行准备","确认博物馆预约时间","整理随身行李清单","旅途安排","核对酒店入住信息","回复供应商报价邮件","完成本周采购交接说明","晚上散步二十分钟"};
        String[] parents={null,"ui0","ui1","ui1","ui0","ui4",null,null,null};
        for(int i=0;i<titles.length;i++) {
            JSONObject task=new JSONObject().put("id","ui"+i).put("title",titles[i]).put("parent_id",parents[i]==null?JSONObject.NULL:parents[i])
                .put("root_bucket",parents[i]==null?"categories":JSONObject.NULL).put("note","").put("sort_order",i).put("status","open")
                .put("completed_at",JSONObject.NULL).put("archived_at",JSONObject.NULL).put("due_type","none").put("due_date",JSONObject.NULL).put("due_at",JSONObject.NULL)
                .put("quadrant",i==2?"Q1":JSONObject.NULL).put("planned_date",i==2||i==3||i>=5?today:JSONObject.NULL)
                .put("created_at",java.time.Instant.now().toString()).put("updated_at",java.time.Instant.now().toString()).put("deleted_at",JSONObject.NULL).put("deletion_batch_id",JSONObject.NULL);
            changes.put(new JSONObject().put("collection","tasks").put("id","ui"+i).put("position",i).put("value",task.toString()));
        }
        com.getcapacitor.JSObject op=new com.getcapacitor.JSObject();op.put("expected_revision",state.getLong("revision"));op.put("operation_id","ui-seed-"+System.nanoTime());op.put("changes",changes);
        op.put("settings",new JSONObject().put("timezone","Asia/Shanghai").put("initialized",true));op.put("ai_settings",state.getJSONObject("data").getJSONObject("ai_settings"));
        NativeWorkspaceTest.Call call=new NativeWorkspaceTest.Call(op);plugin.commit(call);call.await();
    }
    private void waitUntil(ActivityScenario<MainActivity> activity,String expression) throws Exception {
        for(int i=0;i<100;i++){ if(js(activity,"return {ok:!!("+expression+")};").optBoolean("ok"))return;SystemClock.sleep(100); }
        throw new AssertionError(expression);
    }
    @Test public void mobileExecutionProjectsAndCalendar() throws Exception {
        seed();
        try(ActivityScenario<MainActivity> activity=ActivityScenario.launch(MainActivity.class)) {
            waitFor(activity,".m-task");SystemClock.sleep(500);
            JSONObject bounds=js(activity,"const h=document.querySelector('.m-header').getBoundingClientRect();const n=document.querySelector('.mobile-navigation').getBoundingClientRect();const c=document.querySelector('.m-composer').getBoundingClientRect();const css=getComputedStyle(document.documentElement);return {top:h.top,safeTop:parseFloat(css.getPropertyValue('--safe-area-inset-top'))||0,navBottom:n.bottom,height:innerHeight,width:innerWidth,scroll:document.documentElement.scrollWidth,composerFits:c.bottom<=n.top+1,rows:document.querySelectorAll('.m-task').length};");
            assertTrue(bounds.toString(),bounds.getDouble("top")>=bounds.getDouble("safeTop")-1);
            assertTrue(bounds.toString(),bounds.getDouble("navBottom")<=bounds.getDouble("height")+1);
            assertTrue(bounds.toString(),bounds.getDouble("scroll")<=bounds.getDouble("width")+1);
            assertTrue(bounds.toString(),bounds.getBoolean("composerFits"));assertEquals(6,bounds.getInt("rows"));screenshot("today-populated");
            js(activity,"document.querySelector('[data-task-id=ui2] .m-check-target').click();return {};");
            js(activity,"document.querySelector('[data-task-id=ui3] .m-check-target').click();return {};");
            waitUntil(activity,"document.querySelectorAll('.is-pending').length===2");screenshot("multi-confirm");
            js(activity,"document.querySelector('.m-confirm-bar .m-primary').click();return {};");
            waitUntil(activity,"!document.querySelector('[data-task-id=ui2]')");
            js(activity,"document.querySelectorAll('.mobile-navigation button')[1].click();return {};");waitFor(activity,"[data-task-id=ui0]");
            js(activity,"document.querySelector('[data-task-id=ui0] .m-task-body').click();return {};");waitFor(activity,"[data-task-id=ui1].is-done");
            assertTrue(js(activity,"return {kept:!!document.querySelector('[data-task-id=ui4]')};").getBoolean("kept"));screenshot("project-retained-branch");
            js(activity,"document.querySelectorAll('.mobile-navigation button')[0].click();return {};");
            waitUntil(activity,"document.querySelector('.m-heading h1')?.textContent==='今天'");
            js(activity,"document.querySelector('.m-date-link').click();return {};");waitFor(activity,".calendar-day-detail");screenshot("calendar");
            js(activity,"document.querySelector('[aria-label=返回上一级]').click();return {};");
            waitUntil(activity,"!document.querySelector('.calendar-day-detail') && !!document.querySelector('.m-composer-line input')");
            JSONObject field=js(activity,"const r=document.querySelector('.m-composer-line input').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth};");
            CompletableFuture<float[]> tap=new CompletableFuture<>();
            activity.onActivity(a->{
                android.webkit.WebView web=a.getBridge().getWebView();int[] location=new int[2];web.getLocationOnScreen(location);
                float scale=web.getWidth()/(float)field.optDouble("width");
                tap.complete(new float[]{location[0]+(float)field.optDouble("x")*scale,location[1]+(float)field.optDouble("y")*scale});
            });
            float[] point=tap.get(5,TimeUnit.SECONDS);long down=SystemClock.uptimeMillis();
            android.view.MotionEvent press=android.view.MotionEvent.obtain(down,down,android.view.MotionEvent.ACTION_DOWN,point[0],point[1],0);
            android.view.MotionEvent release=android.view.MotionEvent.obtain(down,down+60,android.view.MotionEvent.ACTION_UP,point[0],point[1],0);
            InstrumentationRegistry.getInstrumentation().sendPointerSync(press);
            InstrumentationRegistry.getInstrumentation().sendPointerSync(release);press.recycle();release.recycle();
            boolean keyboard=false;
            for(int i=0;i<50&&!keyboard;i++) {
                CompletableFuture<Boolean> visible=new CompletableFuture<>();
                activity.onActivity(a->{android.view.WindowInsets insets=a.getWindow().getDecorView().getRootWindowInsets();visible.complete(insets!=null&&insets.isVisible(android.view.WindowInsets.Type.ime()));});
                keyboard=visible.get(5,TimeUnit.SECONDS);if(!keyboard)SystemClock.sleep(100);
            }
            assertTrue("Real touch must open the software keyboard",keyboard);
            waitUntil(activity,"document.querySelector('.m-composer-line input')===document.activeElement");
            waitUntil(activity,"getComputedStyle(document.querySelector('.mobile-navigation')).display==='none'");
            JSONObject keyboardBounds=js(activity,"const r=document.querySelector('.m-composer').getBoundingClientRect();return {bottom:r.bottom,height:innerHeight};");
            assertTrue(keyboardBounds.toString(),keyboardBounds.getDouble("bottom")<=keyboardBounds.getDouble("height")+1);
            screenshot("keyboard");
            js(activity,"document.querySelector('.m-composer-line input').blur();return {};");
        }
    }
}
