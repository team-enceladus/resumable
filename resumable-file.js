(function() {
  var ResumableChunk = require('./resumable-chunk');
  function ResumableFile(resumableObj, file, uniqueIdentifier){
    var $ = this;
    var $h = require('./resumable-helpers')(resumableObj);    
    $.opts = {};
    $.getOpt = resumableObj.getOpt;
    $._prevProgress = 0;
    $.resumableObj = resumableObj;
    $.file = file;
    $.fileName = file.fileName||file.name; // Some confusion in different versions of Firefox
    $.size = file.size;
    $.relativePath = file.relativePath || file.webkitRelativePath || $.fileName;
    $.uniqueIdentifier = uniqueIdentifier;
    $._pause = false;
    $.container = '';
    var _error = uniqueIdentifier !== undefined;

    // Callback when something happens within the chunk
    var chunkEvent = function(event, message, offset){
      // event can be 'progress', 'success', 'error' or 'retry'
      switch(event){
      case 'progress':
        $.resumableObj.fire('fileProgress', $, message);
        break;
      case 'no_network':
        $.resumableObj.fire('networkDown', $, message);
        break;
      case 'error':
        $.abort();
        _error = true;
        $.chunks = [];
        $.resumableObj.fire('fileError', $, message);
        break;
      case 'success':
        if(_error) return;
        $.resumableObj.fire('fileProgress', $); // it's at least progress
        $.resumableObj.fire('chunkFinished', offset);
        if($.isComplete()) {
          $.resumableObj.fire('fileSuccess', $, message);
        }
        break;
      case 'retry':
        $.resumableObj.fire('fileRetry', $);
        break;
      }
    };

    // Main code to set up a file object with chunks,
    // packaged to be able to handle retries if needed.
    $.chunks = [];
    $.abort = function(){
      // Stop current uploads
      var abortCount = 0;
      $h.each($.chunks, function(c){
        if(c.status()=='uploading') {
          c.abort();
          abortCount++;
        }
      });
      if(abortCount>0) $.resumableObj.fire('fileProgress', $);
    };
    $.cancel = function(){
      // Reset this file to be void
      var _chunks = $.chunks;
      $.chunks = [];
      // Stop current uploads
      $h.each(_chunks, function(c){
        if(c.status()=='uploading')  {
          c.abort();
          $.resumableObj.uploadNextChunk();
        }
      });
      $.resumableObj.removeFile($);
      $.resumableObj.fire('fileProgress', $);
    };
    $.retry = function(){
      $.bootstrap();
      var firedRetry = false;
      $.resumableObj.on('chunkingComplete', function(){
        if(!firedRetry) $.resumableObj.upload();
        firedRetry = true;
      });
    };
    $.bootstrap = function(){
      $.abort();
      _error = false;
      // Rebuild stack of chunks from file
      $.chunks = [];
      $._prevProgress = 0;
      var round = $.getOpt('forceChunkSize') ? Math.ceil : Math.floor;
      var maxOffset = Math.max(round($.file.size/$.getOpt('chunkSize')),1);
      for (var offset=0; offset<maxOffset; offset++) {(function(offset){
          window.setTimeout(function(){
              $.chunks.push(new ResumableChunk($.resumableObj, $, offset, chunkEvent));
              $.resumableObj.fire('chunkingProgress',$,offset/maxOffset);
          },0);
      })(offset)}
      window.setTimeout(function(){
          $.resumableObj.fire('chunkingComplete',$);
      },0);
    };
    $.progress = function(){
      if(_error) {
        return(1)
      };
      // Sum up progress across everything
      var ret = 0;
      var error = false;
      $h.each($.chunks, function(c){
        if(c.status()=='error') error = true;
        ret += c.progress(true); // get chunk progress relative to entire file
      });
      // console.log('got error?', error);
      if (error) {
        return $._prevProgress;
      }
      ret = (ret>0.99999 ? 1 : ret);
      ret = Math.max($._prevProgress, ret); // We don't want to lose percentages when an upload is paused
      $._prevProgress = ret;
      return(ret);
    };
    $.isUploading = function(){
      var uploading = false;
      $h.each($.chunks, function(chunk){
        if(chunk.status()=='uploading') {
          uploading = true;
          return(false);
        }
      });
      return(uploading);
    };
    $.isComplete = function(){
      var outstanding = false;
      $h.each($.chunks, function(chunk){
        var status = chunk.status();
        if(status=='pending' || status=='uploading' || chunk.preprocessState === 1) {
          outstanding = true;
          return(false);
        }
      });
      return(!outstanding);
    };
    $.pause = function(pause){
      if(typeof(pause)==='undefined'){
          $._pause = ($._pause ? false : true);
      }else{
          $._pause = pause;
      }
    };
    $.isPaused = function() {
      return $._pause;
    };


    // Bootstrap and return
    $.resumableObj.fire('chunkingStart', $);
    $.bootstrap();
    return(this);
  }
  // Node.js-style export for Node and Component
  if (typeof module != 'undefined') {
    module.exports = ResumableFile;
  } else if (typeof define === "function" && define.amd) {
    // AMD/requirejs: Define the module
    define(function(){
      return ResumableFile;
    });
  } else {
    // Browser: Expose to window
    window.ResumableFile = ResumableFile;
  }
})()