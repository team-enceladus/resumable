/*
* MIT Licensed
* http://www.23developer.com/opensource
* http://github.com/23/resumable.js
* Steffen Tiedemann Christensen, steffen@23company.com
*/
(function(){
"use strict";
  var ResumableChunk = require('./resumable-chunk');
  var ResumableFile = require('./resumable-file');
  var Resumable = function(opts){
    if ( !(this instanceof Resumable) ) {
      return new Resumable(opts);
    }
    this.version = 1.0;
    // SUPPORTED BY BROWSER?
    // Check if these features are support by the browser:
    // - File object type
    // - Blob object type
    // - FileList object type
    // - slicing files
    this.support = (
                   (typeof(File)!=='undefined')
                   &&
                   (typeof(Blob)!=='undefined')
                   &&
                   (typeof(FileList)!=='undefined')
                   &&
                   (!!Blob.prototype.webkitSlice||!!Blob.prototype.mozSlice||!!Blob.prototype.slice||false)
                   );
    console.log(this.support);
    if(!this.support) return(false);


    // PROPERTIES
    var $ = this;
    $.files = [];
    $.defaults = {
      isConnectedToNetwork: function() {return true},
      chunkSize:1*1024*1024,
      forceChunkSize:false,
      simultaneousUploads: 13,
      fileParameterName:'file',
      chunkNumberParameterName: 'resumableChunkNumber',
      chunkSizeParameterName: 'resumableChunkSize',
      currentChunkSizeParameterName: 'resumableCurrentChunkSize',
      totalSizeParameterName: 'resumableTotalSize',
      typeParameterName: 'resumableType',
      identifierParameterName: 'resumableIdentifier',
      fileNameParameterName: 'resumableFilename',
      relativePathParameterName: 'resumableRelativePath',
      totalChunksParameterName: 'resumableTotalChunks',
      throttleProgressCallbacks: 0.5,
      query:{},
      headers:{},
      preprocess:null,
      method:'multipart',
      uploadMethod: 'POST',
      testMethod: 'GET',
      prioritizeFirstAndLastChunk:false,
      target:'/',
      testTarget: null,
      parameterNamespace:'',
      testChunks:true,
      generateUniqueIdentifier:null,
      getTarget:null,
      maxChunkRetries:100,
      chunkRetryInterval:undefined,
      permanentErrors:[400, 404, 415, 500, 501],
      maxFiles:undefined,
      withCredentials:false,
      xhrTimeout:0,
      clearInput:true,
      chunkFormat:'blob',
      setChunkTypeFromFile:false,
      maxFilesErrorCallback:function (files, errorCount) {
        var maxFiles = $.getOpt('maxFiles');
        alert('Please upload no more than ' + maxFiles + ' file' + (maxFiles === 1 ? '' : 's') + ' at a time.');
      },
      minFileSize:1,
      minFileSizeErrorCallback:function(file, errorCount) {
        alert(file.fileName||file.name +' is too small, please upload files larger than ' + $h.formatSize($.getOpt('minFileSize')) + '.');
      },
      maxFileSize:undefined,
      maxFileSizeErrorCallback:function(file, errorCount) {
        alert(file.fileName||file.name +' is too large, please upload files less than ' + $h.formatSize($.getOpt('maxFileSize')) + '.');
      },
      fileType: [],
      fileTypeErrorCallback: function(file, errorCount) {
        alert(file.fileName||file.name +' has type not allowed, please upload files of type ' + $.getOpt('fileType') + '.');
      }
    };
    $.opts = opts||{};
    $.getOpt = function(o) {
      var $opt = this;
      // Get multiple option if passed an array
      if(o instanceof Array) {
        var options = {};
        $h.each(o, function(option){
          options[option] = $opt.getOpt(option);
        });
        return options;
      }
      // Otherwise, just return a simple option
      if ($opt instanceof ResumableChunk) {
        if (typeof $opt.opts[o] !== 'undefined') { return $opt.opts[o]; }
        else { $opt = $opt.fileObj; }
      }
      if ($opt instanceof ResumableFile) {
        if (typeof $opt.opts[o] !== 'undefined') { return $opt.opts[o]; }
        else { $opt = $opt.resumableObj; }
      }
      if ($opt instanceof Resumable) {
        if (typeof $opt.opts[o] !== 'undefined') { return $opt.opts[o]; }
        else { return $opt.defaults[o]; }
      }
    };
    $.isConnectedToNetwork = function() {
      return $.getOpt('isConnectedToNetwork')();
      // return Promise.resolve($.getOpt('isConnectedToNetwork')())
    }

    // EVENTS
    // catchAll(event, ...)
    // fileSuccess(file), fileProgress(file), fileAdded(file, event), filesAdded(files, filesSkipped), fileRetry(file),
    // fileError(file, message), complete(), progress(), error(message, file), pause()
    $.events = [];
    $.on = function(event,callback){
      $.events.push(event.toLowerCase(), callback);
    };
    $.fire = function(){
      // `arguments` is an object, not array, in FF, so:
      var args = [];
      for (var i=0; i<arguments.length; i++) args.push(arguments[i]);
      // Find event listeners, and support pseudo-event `catchAll`
      var event = args[0].toLowerCase();

      for (var i=0; i<=$.events.length; i+=2) {
        if($.events[i]==event) $.events[i+1].apply($,args.slice(1));
        if($.events[i]=='catchall') $.events[i+1].apply(null,args);
      }
      if(event=='fileerror') $.fire('error', args[2], args[1]);
      if(event=='fileprogress') $.fire('progress');
    };


    // INTERNAL HELPER METHODS (handy, but ultimately not part of uploading)
    var $h = require('./resumable-helpers')($);

    var onDrop = function(event){
      $h.stopEvent(event);

      //handle dropped things as items if we can (this lets us deal with folders nicer in some cases)
      if (event.dataTransfer && event.dataTransfer.items) {
        loadFiles(event.dataTransfer.items, event);
      }
      //else handle them as files
      else if (event.dataTransfer && event.dataTransfer.files) {
        loadFiles(event.dataTransfer.files, event);
      }
    };
    var preventDefault = function(e) {
      e.preventDefault();
    };

    /**
     * processes a single upload item (file or directory)
     * @param {Object} item item to upload, may be file or directory entry
     * @param {string} path current file path
     * @param {File[]} items list of files to append new items to
     * @param {Function} cb callback invoked when item is processed
     */
    function processItem(item, path, items, cb) {
      var entry;
      if(item.isFile){
        // file provided
        return item.file(function(file){
          file.relativePath = path + file.name;
          items.push(file);
          cb();
        });
      }else if(item.isDirectory){
        // item is already a directory entry, just assign
        entry = item;
      }else if(item instanceof File) {
        items.push(item);
      }
      if('function' === typeof item.webkitGetAsEntry){
        // get entry from file object
        entry = item.webkitGetAsEntry();
      }
      if(entry && entry.isDirectory){
        // directory provided, process it
        return processDirectory(entry, path + entry.name + '/', items, cb);
      }
      if('function' === typeof item.getAsFile){
        // item represents a File object, convert it
        item = item.getAsFile();
        if(item instanceof File) {
          item.relativePath = path + item.name;
          items.push(item);
        }
      }
      cb(); // indicate processing is done
    }


    /**
     * cps-style list iteration.
     * invokes all functions in list and waits for their callback to be
     * triggered.
     * @param  {Function[]}   items list of functions expecting callback parameter
     * @param  {Function} cb    callback to trigger after the last callback has been invoked
     */
    function processCallbacks(items, cb){
      if(!items || items.length === 0){
        // empty or no list, invoke callback
        return cb();
      }
      // invoke current function, pass the next part as continuation
      items[0](function(){
        processCallbacks(items.slice(1), cb);
      });
    }

    /**
     * recursively traverse directory and collect files to upload
     * @param  {Object}   directory directory to process
     * @param  {string}   path      current path
     * @param  {File[]}   items     target list of items
     * @param  {Function} cb        callback invoked after traversing directory
     */
    function processDirectory (directory, path, items, cb) {
      var dirReader = directory.createReader();
      dirReader.readEntries(function(entries){
        if(!entries.length){
          // empty directory, skip
          return cb();
        }
        // process all conversion callbacks, finally invoke own one
        processCallbacks(
          entries.map(function(entry){
            // bind all properties except for callback
            return processItem.bind(null, entry, path, items);
          }),
          cb
        );
      });
    }

    /**
     * process items to extract files to be uploaded
     * @param  {File[]} items items to process
     * @param  {Event} event event that led to upload
     */
    function loadFiles(items, event) {
      if(!items.length){
        return; // nothing to do
      }
      $.fire('beforeAdd');
      var files = [];
      processCallbacks(
          Array.prototype.map.call(items, function(item){
            // bind all properties except for callback
            return processItem.bind(null, item, "", files);
          }),
          function(){
            if(files.length){
              // at least one file found
              appendFilesFromFileList(files, event);
            }
          }
      );
    };

    var appendFilesFromFileList = function(fileList, event){
      // check for uploading too many files
      var errorCount = 0;
      var o = $.getOpt(['maxFiles', 'minFileSize', 'maxFileSize', 'maxFilesErrorCallback', 'minFileSizeErrorCallback', 'maxFileSizeErrorCallback', 'fileType', 'fileTypeErrorCallback']);
      if (typeof(o.maxFiles)!=='undefined' && o.maxFiles<(fileList.length+$.files.length)) {
        // if single-file upload, file is already added, and trying to add 1 new file, simply replace the already-added file
        if (o.maxFiles===1 && $.files.length===1 && fileList.length===1) {
          $.removeFile($.files[0]);
        } else {
          o.maxFilesErrorCallback(fileList, errorCount++);
          return false;
        }
      }
      var files = [], filesSkipped = [], remaining = fileList.length;
      var decreaseReamining = function(){
        if(!--remaining){
          // all files processed, trigger event
          if(!files.length && !filesSkipped.length){
            // no succeeded files, just skip
            return;
          }
          window.setTimeout(function(){
            $.fire('filesAdded', files, filesSkipped);
          },0);
        }
      };
      $h.each(fileList, function(file){
        var fileName = file.name;
        if(o.fileType.length > 0){
          var fileTypeFound = false;
          for(var index in o.fileType){
            var extension = '.' + o.fileType[index];
      if(fileName.toLowerCase().indexOf(extension.toLowerCase(), fileName.length - extension.length) !== -1){
              fileTypeFound = true;
              break;
            }
          }
          if (!fileTypeFound) {
            o.fileTypeErrorCallback(file, errorCount++);
            return false;
          }
        }

        if (typeof(o.minFileSize)!=='undefined' && file.size<o.minFileSize) {
          o.minFileSizeErrorCallback(file, errorCount++);
          return false;
        }
        if (typeof(o.maxFileSize)!=='undefined' && file.size>o.maxFileSize) {
          o.maxFileSizeErrorCallback(file, errorCount++);
          return false;
        }

        function addFile(uniqueIdentifier){
          if (!$.getFromUniqueIdentifier(uniqueIdentifier)) {(function(){
            file.uniqueIdentifier = uniqueIdentifier;
            var f = new ResumableFile($, file, uniqueIdentifier);
            $.files.push(f);
            files.push(f);
            f.container = (typeof event != 'undefined' ? event.srcElement : null);
            window.setTimeout(function(){
              $.fire('fileAdded', f, event)
            },0);
          })()} else {
            filesSkipped.push(file);
          };
          decreaseReamining();
        }
        // directories have size == 0
        var uniqueIdentifier = $h.generateUniqueIdentifier(file, event);
        if(uniqueIdentifier && typeof uniqueIdentifier.then === 'function'){
          // Promise or Promise-like object provided as unique identifier
          uniqueIdentifier
          .then(
            function(uniqueIdentifier){
              // unique identifier generation succeeded
              addFile(uniqueIdentifier);
            },
           function(){
              // unique identifier generation failed
              // skip further processing, only decrease file count
              decreaseReamining();
            }
          );
        }else{
          // non-Promise provided as unique identifier, process synchronously
          addFile(uniqueIdentifier);
        }
      });
    };

    // INTERNAL OBJECT TYPES
    


    // QUEUE
    $.uploadNextChunk = function(){
      var found = false;

      // In some cases (such as videos) it's really handy to upload the first
      // and last chunk of a file quickly; this let's the server check the file's
      // metadata and determine if there's even a point in continuing.
      if ($.getOpt('prioritizeFirstAndLastChunk')) {
        $h.each($.files, function(file){
          if(file.chunks.length && file.chunks[0].status()=='pending' && file.chunks[0].preprocessState === 0) {
            file.chunks[0].send();
            found = true;
            return(false);
          }
          if(file.chunks.length>1 && file.chunks[file.chunks.length-1].status()=='pending' && file.chunks[file.chunks.length-1].preprocessState === 0) {
            file.chunks[file.chunks.length-1].send();
            found = true;
            return(false);
          }
        });
        if(found) return(true);
      }

      // Now, simply look for the next, best thing to upload
      $h.each($.files, function(file){
        if(file.isPaused()===false){
         $h.each(file.chunks, function(chunk){
           if(chunk.status()=='pending' && chunk.preprocessState === 0) {
             chunk.send();
             found = true;
             return(false);
           }
          });
        }
        if(found) return(false);
      });
      if(found) return(true);

      // The are no more outstanding chunks to upload, check is everything is done
      var outstanding = false;
      $h.each($.files, function(file, i){
        if(!file.isComplete()) {
          outstanding = true;
          return(false);
        }
      });
      if(!outstanding) {
        // All chunks have been uploaded, complete
        $.fire('complete');
      }
      return(false);
    };


    // PUBLIC METHODS FOR RESUMABLE.JS
    $.assignBrowse = function(domNodes, isDirectory){
      if(typeof(domNodes.length)=='undefined') domNodes = [domNodes];

      $h.each(domNodes, function(domNode) {
        var input;
        if(domNode.tagName==='INPUT' && domNode.type==='file'){
          input = domNode;
        } else {
          input = document.createElement('input');
          input.setAttribute('type', 'file');
          input.style.display = 'none';
          domNode.addEventListener('click', function(){
            input.style.opacity = 0;
            input.style.display='block';
            input.focus();
            input.click();
            input.style.display='none';
          }, false);
          domNode.appendChild(input);
        }
        var maxFiles = $.getOpt('maxFiles');
        if (typeof(maxFiles)==='undefined'||maxFiles!=1){
          input.setAttribute('multiple', 'multiple');
        } else {
          input.removeAttribute('multiple');
        }
        if(isDirectory){
          input.setAttribute('webkitdirectory', 'webkitdirectory');
        } else {
          input.removeAttribute('webkitdirectory');
        }
        var fileTypes = $.getOpt('fileType');
        if (typeof (fileTypes) !== 'undefined' && fileTypes.length >= 1) {
          input.setAttribute('accept', fileTypes.map(function (e) { return '.' + e }).join(','));
        }
        else {
          input.removeAttribute('accept');
        }
        // When new files are added, simply append them to the overall list
        input.addEventListener('change', function(e){
          appendFilesFromFileList(e.target.files,e);
          var clearInput = $.getOpt('clearInput');
          if (clearInput) {
            e.target.value = '';
          }
        }, false);
      });
    };
    $.assignDrop = function(domNodes){
      if(typeof(domNodes.length)=='undefined') domNodes = [domNodes];

      $h.each(domNodes, function(domNode) {
        domNode.addEventListener('dragover', preventDefault, false);
        domNode.addEventListener('dragenter', preventDefault, false);
        domNode.addEventListener('drop', onDrop, false);
      });
    };
    $.unAssignDrop = function(domNodes) {
      if (typeof(domNodes.length) == 'undefined') domNodes = [domNodes];

      $h.each(domNodes, function(domNode) {
        domNode.removeEventListener('dragover', preventDefault);
        domNode.removeEventListener('dragenter', preventDefault);
        domNode.removeEventListener('drop', onDrop);
      });
    };
    $.isUploading = function(){
      var uploading = false;
      $h.each($.files, function(file){
        if (file.isUploading()) {
          uploading = true;
          return(false);
        }
      });
      return(uploading);
    };
    $.upload = function(){
      // Make sure we don't start too many uploads at once
      if($.isUploading()) return;
      // Kick off the queue
      $.fire('uploadStart');
      for (var num=1; num<=$.getOpt('simultaneousUploads'); num++) {
        $.uploadNextChunk();
      }
    };
    $.pause = function(a){
      // Resume all chunks currently being uploaded
      $h.each($.files, function(file){
        file.abort();
      });
      $.fire('pause');
    };
    $.cancel = function(){
      $.fire('beforeCancel');
      for(var i = $.files.length - 1; i >= 0; i--) {
        $.files[i].cancel();
      }
      $.fire('cancel');
    };
    $.progress = function(){
      var totalDone = 0;
      var totalSize = 0;
      // Resume all chunks currently being uploaded
      $h.each($.files, function(file){
        totalDone += file.progress()*file.size;
        totalSize += file.size;
      });
      return(totalSize>0 ? totalDone/totalSize : 0);
    };
    $.addFile = function(file, event){
      appendFilesFromFileList([file], event);
    };
    $.removeFile = function(file){
      for(var i = $.files.length - 1; i >= 0; i--) {
        if($.files[i] === file) {
          $.files.splice(i, 1);
        }
      }
    };
    $.getFromUniqueIdentifier = function(uniqueIdentifier){
      var ret = false;
      $h.each($.files, function(f){
        if(f.uniqueIdentifier==uniqueIdentifier) ret = f;
      });
      return(ret);
    };
    $.getSize = function(){
      var totalSize = 0;
      $h.each($.files, function(file){
        totalSize += file.size;
      });
      return(totalSize);
    };
    $.handleDropEvent = function (e) {
      onDrop(e);
    };
    $.handleChangeEvent = function (e) {
      appendFilesFromFileList(e.target.files, e);
      e.target.value = '';
    };
    $.updateQuery = function(query){
        $.opts.query = query;
    };

    return(this);
  };


  // Node.js-style export for Node and Component
  if (typeof module != 'undefined') {
    module.exports = Resumable;
  } else if (typeof define === "function" && define.amd) {
    // AMD/requirejs: Define the module
    define(function(){
      return Resumable;
    });
  } else {
    // Browser: Expose to window
    window.Resumable = Resumable;
  }

})();
