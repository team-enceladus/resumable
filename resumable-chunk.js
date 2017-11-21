(function() {
  function ResumableChunk(resumableObj, fileObj, offset, callback){
    var $ = this;
    var $h = require('./resumable-helpers')(resumableObj);    
    $.opts = {};
    $.getOpt = resumableObj.getOpt;
    $.resumableObj = resumableObj;
    $.fileObj = fileObj;
    $.fileObjSize = fileObj.size;
    $.fileObjType = fileObj.file.type;
    $.offset = offset;
    $.callback = callback;
    $.lastProgressCallback = (new Date);
    $.lastStatus = undefined;
    $.tested = false;
    $.retries = 0;
    $.pendingRetry = false;
    $.lastProgress = 0;
    $.preprocessState = 0; // 0 = unprocessed, 1 = processing, 2 = finished

    // Computed properties
    var chunkSize = $.getOpt('chunkSize');
    $.loaded = 0;
    $.startByte = $.offset*chunkSize;
    $.endByte = Math.min($.fileObjSize, ($.offset+1)*chunkSize);
    if ($.fileObjSize-$.endByte < chunkSize && !$.getOpt('forceChunkSize')) {
      // The last chunk will be bigger than the chunk size, but less than 2*chunkSize
      $.endByte = $.fileObjSize;
    }
    $.xhr = null;

    $.isComplete = function() {
      return $.status() === 'success';
    }

    // test() makes a GET request without any data to see if the chunk has already been uploaded in a previous session
    $.test = function(){
      // Set up request and listen for event
      $.xhr = new XMLHttpRequest();


      // Write custom test status.
      var testHandler = function(e){
        $.tested = true;
        var status = $.status(true);
        // console.log('test result', e, status, $.xhr.status)
        if(status=='success') {
          $.callback(status, $.message());
          // console.log('test chunk already exists') // dependent on server impl
          $.resumableObj.uploadNextChunk();
        } else if (status === 'chunk_not_found') {
          // console.log('test chunk does not exist') // dependent on server impl
          $.send();
        }
      };
      $.xhr.addEventListener('load', testHandler, false);
      $.xhr.addEventListener('error', testHandler, false);
      $.xhr.addEventListener('timeout', testHandler, false);

      // Add data from the query options
      var params = [];
      var parameterNamespace = $.getOpt('parameterNamespace');
      var customQuery = $.getOpt('query');
      if(typeof customQuery == 'function') customQuery = customQuery($.fileObj, $);
      $h.each(customQuery, function(k,v){
        params.push([encodeURIComponent(parameterNamespace+k), encodeURIComponent(v)].join('='));
      });
      // Add extra data to identify chunk
      params = params.concat(
        [
          // define key/value pairs for additional parameters
          ['chunkNumberParameterName', $.offset + 1],
          ['chunkSizeParameterName', $.getOpt('chunkSize')],
          ['currentChunkSizeParameterName', $.endByte - $.startByte],
          ['totalSizeParameterName', $.fileObjSize],
          ['typeParameterName', $.fileObjType],
          ['identifierParameterName', $.fileObj.uniqueIdentifier],
          ['fileNameParameterName', $.fileObj.fileName],
          ['relativePathParameterName', $.fileObj.relativePath],
          ['totalChunksParameterName', $.fileObj.chunks.length]
        ].filter(function(pair){
          // include items that resolve to truthy values
          // i.e. exclude false, null, undefined and empty strings
          return $.getOpt(pair[0]);
        })
        .map(function(pair){
          // map each key/value pair to its final form
          return [
            parameterNamespace + $.getOpt(pair[0]),
            encodeURIComponent(pair[1])
          ].join('=');
        })
      );
      // Append the relevant chunk and send it
      $.xhr.open($.getOpt('testMethod'), $h.getTarget('test', params), true);
      $.xhr.timeout = $.getOpt('xhrTimeout');
      $.xhr.withCredentials = $.getOpt('withCredentials');
      // Add data from header options
      var customHeaders = $.getOpt('headers');
      if(typeof customHeaders === 'function') {
        customHeaders = customHeaders($.fileObj, $);
      }
      $h.each(customHeaders, function(k,v) {
        $.xhr.setRequestHeader(k, v);
      });
      $.xhr.send(null);
    };

    $.preprocessFinished = function(){
      $.preprocessState = 2;
      $.send();
    };

    // send() uploads the actual data in a POST call
    $.send = function(){
      var preprocess = $.getOpt('preprocess');
      if(typeof preprocess === 'function') {
        switch($.preprocessState) {
        case 0: $.preprocessState = 1; preprocess($); return;
        case 1: return;
        case 2: break;
        }
      }
      if($.getOpt('testChunks') && !$.tested) {
        $.test();
        return;
      }
      
      // Set up request and listen for event
      $.xhr = new XMLHttpRequest();

      // Progress
      $.xhr.upload.addEventListener('progress', function(e){
        if( (new Date) - $.lastProgressCallback > $.getOpt('throttleProgressCallbacks') * 1000 ) {
          $.callback('progress');
          $.lastProgressCallback = (new Date);
        }
        $.loaded=e.loaded||0;
      }, false);
      $.loaded = 0;
      $.pendingRetry = false;
      $.callback('progress');

      // Done (either done, failed or retry)
      var doneHandler = function(e){
        setImmediate(() => {
          var status = $.status();
          if (e && e.detail && (e.detail.message === 'The Internet connection appears to be offline.')) {
            $.preprocessState = 0;
            $.callback('no_network', $.message());            
          } else if (e && e.details &&
            e.detail.message === 'cancelled') {
            $.callback('cancelled', $.message());
          } else if(status=='success'|| status=='error') {
            $.callback(status, $.message(), $.offset);
            if (!$.fileObj.isPaused()) {
              $.resumableObj.uploadNextChunk();
            }
          } else {
            $.callback('retry', $.message());
            $.abort();
            $.retries++;
            var retryInterval = $.getOpt('chunkRetryInterval');
            if(retryInterval !== undefined) {
              $.pendingRetry = true;
              setTimeout($.send, retryInterval);
            } else {
              $.send();
            }
          }
        })
      };
      $.xhr.addEventListener('load', doneHandler, false);
      $.xhr.addEventListener('error', doneHandler, false);
      $.xhr.addEventListener('timeout', doneHandler, false);

      // Set up the basic query data from Resumable
      var query = [
        ['chunkNumberParameterName', $.offset + 1],
        ['chunkSizeParameterName', $.getOpt('chunkSize')],
        ['currentChunkSizeParameterName', $.endByte - $.startByte],
        ['totalSizeParameterName', $.fileObjSize],
        ['typeParameterName', $.fileObjType],
        ['identifierParameterName', $.fileObj.uniqueIdentifier],
        ['fileNameParameterName', $.fileObj.fileName],
        ['relativePathParameterName', $.fileObj.relativePath],
        ['totalChunksParameterName', $.fileObj.chunks.length],
      ].filter(function(pair){
        // include items that resolve to truthy values
        // i.e. exclude false, null, undefined and empty strings
        return $.getOpt(pair[0]);
      })
      .reduce(function(query, pair){
        // assign query key/value
        query[$.getOpt(pair[0])] = pair[1];
        return query;
      }, {});
      // Mix in custom data
      var customQuery = $.getOpt('query');
      if(typeof customQuery == 'function') customQuery = customQuery($.fileObj, $);
      $h.each(customQuery, function(k,v){
        query[k] = v;
      });

      var func = ($.fileObj.file.slice ? 'slice' : ($.fileObj.file.mozSlice ? 'mozSlice' : ($.fileObj.file.webkitSlice ? 'webkitSlice' : 'slice')));
      Promise.resolve($.fileObj.file[func]($.startByte, $.endByte, $.getOpt('setChunkTypeFromFile') ? $.fileObj.file.type : void 0))
      .then((blob) => {
        var data = null;
        var params = [];

        var parameterNamespace = $.getOpt('parameterNamespace');
                if ($.getOpt('method') === 'octet') {
                    // Add data from the query options
                    data = blob;
                    $h.each(query, function (k, v) {
                        params.push([encodeURIComponent(parameterNamespace + k), encodeURIComponent(v)].join('='));
                    });
                } else {
                    // Add data from the query options
                    data = new FormData();
                    $h.each(query, function (k, v) {
                        data.append(parameterNamespace + k, v);
                        params.push([encodeURIComponent(parameterNamespace + k), encodeURIComponent(v)].join('='));
                    });
                    if ($.getOpt('chunkFormat') == 'blob') {
                      // data.append(parameterNamespace + $.getOpt('fileParameterName'), blob, $.fileObj.fileName);
                    }
                    else if ($.getOpt('chunkFormat') == 'base64') {
                        var fr = new FileReader();
                        fr.onload = function (e) {
                            data.append(parameterNamespace + $.getOpt('fileParameterName'), fr.result);
                            $.xhr.send(data);
                        }
                        fr.readAsDataURL(blob);
                    }
                }

        var target = $h.getTarget('upload', params);
        var method = $.getOpt('uploadMethod');
        var now = Date.now();
        // In the event that the network drops totally,
        // xhr may be unset before slice() resolves.
        if ($.xhr !== null) {
          $.xhr.open(method, target);
          if ($.getOpt('method') === 'octet') {
            $.xhr.setRequestHeader('Content-Type', 'application/octet-stream');
          }
          $.xhr.timeout = $.getOpt('xhrTimeout');
          $.xhr.withCredentials = $.getOpt('withCredentials');
          // Add data from header options
          var customHeaders = $.getOpt('headers');
          if(typeof customHeaders === 'function') {
            customHeaders = customHeaders($.fileObj, $);
          }
  
          $h.each(customHeaders, function(k,v) {
            $.xhr.setRequestHeader(k, v);
          });
          if ($.getOpt('chunkFormat') == 'blob') {
            $.xhr.send(blob);
            // $.xhr.send(new Blob(['aaaaa'])); Test            
          }
        } else {
          $.preprocessState = 0;
          $.callback('no_network');
        }
      })
    };
    $.abort = function(){
      // Abort and reset
      if($.xhr) $.xhr.abort();
      $.xhr = null;
    };
    $.status = function(testing){
      var lastStatus = $.lastStatus;
      var isConnected = $.resumableObj.isConnectedToNetwork();
      // Returns: 'pending', 'uploading', 'success', 'error'
      if($.pendingRetry) {
        // if pending retry then that's effectively the same as actively uploading,
        // there might just be a slight delay before the retry starts
        lastStatus = 'uploading';
      } else if(!$.xhr) {
        lastStatus = 'pending';
      } else if($.xhr.readyState < 4 && !testing) {
        // console.log($.xhr.readyState)
        // Status is really 'OPENED', 'HEADERS_RECEIVED' or 'LOADING' - meaning that stuff is happening
        lastStatus = 'uploading';
      } else {
        if($.xhr.status === 200 || $.xhr.status === 201) {
          // HTTP 200, 201 (created)
          lastStatus = 'success';
        } else if ($.xhr.status === 404 && testing) {
          lastStatus = 'chunk_not_found';
        } else if (!isConnected) {
          $.abort();
          lastStatus = 'no_network';
        } else if($h.contains($.getOpt('permanentErrors'), $.xhr.status) || $.retries >= $.getOpt('maxChunkRetries')) {
          // console.log('perm erros', $.getOpt('permanentErrors'));
          // console.log('status', $.xhr.status)
          // HTTP 415/500/501, permanent error
          lastStatus = 'error';
        } else {
          // this should never happen, but we'll reset and queue a retry
          // a likely case for this would be 503 service unavailable
          $.abort();
          lastStatus = 'pending';
        }
      }
      $.lastStatus = lastStatus;
      return lastStatus;
    };
    $.message = function(){
      return($.xhr ? $.xhr.responseText : '');
    };
    $.progress = function(relative){
      if(typeof(relative)==='undefined') relative = false;
      var factor = (relative ? ($.endByte-$.startByte)/$.fileObjSize : 1);
      if($.pendingRetry) return(0);
      if(!$.xhr || !$.xhr.status) factor*=.95;
      var s = $.status();
      // console.log('in chunk progress', s)
      switch(s){
      case 'success':
        this.lastProgress = (1*factor);
        break;
      case 'no_network':
      case 'error':
      case 'pending':
        return this.lastProgress;
      default:
        this.lastProgress = ($.loaded/($.endByte-$.startByte)*factor);
      }
      return this.lastProgress
    };
    return(this);
  }
  // Node.js-style export for Node and Component
  if (typeof module != 'undefined') {
    module.exports = ResumableChunk;
  } else if (typeof define === "function" && define.amd) {
    // AMD/requirejs: Define the module
    define(function(){
      return ResumableChunk;
    });
  } else {
    // Browser: Expose to window
    window.ResumableChunk = ResumableChunk;
  }
})()