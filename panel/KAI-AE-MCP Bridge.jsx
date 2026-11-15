// KAI-AE-MCP Bridge (fallback only). Use if direct mode doesn't reach After Effects.
// Install: copy to  ...\Adobe After Effects <year>\Support Files\Scripts\ScriptUI Panels\  then open Window > KAI-AE-MCP Bridge.jsx
// It runs job files that the MCP server drops in the queue folder.
(function (thisObj) {
  var home = Folder("~").fsName;
  var queue = new Folder(home + "/KAI-AE-MCP-work/queue");
  var pal = (thisObj instanceof Panel) ? thisObj : new Window("palette", "KAI-AE-MCP Bridge", undefined, { resizeable: true });
  pal.orientation = "column"; pal.alignChildren = ["fill", "top"];
  var status = pal.add("statictext", undefined, "Watching: " + queue.fsName, { multiline: true });
  var on = pal.add("checkbox", undefined, "Run jobs automatically"); on.value = true;
  var last = pal.add("statictext", undefined, "No jobs yet");
  $.global.__kaiBridgeTick = function () {
    if (!on.value || !queue.exists) return;
    var files = queue.getFiles("*.jsx");
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      try { $.evalFile(f); last.text = "Ran " + f.name + " at " + new Date().toTimeString().substr(0, 8); }
      catch (e) { last.text = "Error in " + f.name + ": " + e.toString(); }
      try { f.remove(); } catch (e2) {}
    }
  };
  app.scheduleTask("$.global.__kaiBridgeTick()", 500, true);
  if (pal instanceof Window) { pal.center(); pal.show(); } else pal.layout.layout(true);
})(this);
