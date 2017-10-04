(function() {
  function ResumableHelpers(resumableObj) {
    const $h = {
      stopEvent: function(e){
        e.stopPropagation();
        e.preventDefault();
      },
      each: function(o,callback){
        if(typeof(o.length)!=='undefined') {
          for (var i=0; i<o.length; i++) {
            // Array or FileList
            if(callback(o[i], i)===false) return;
          }
        } else {
          for (i in o) {
            // Object
            if(callback(i,o[i], i)===false) return;
          }
        }
      },
      generateUniqueIdentifier:function(file, event){
        var custom = resumableObj.getOpt('generateUniqueIdentifier');
        if(typeof custom === 'function') {
          return custom(file, event);
        }
        var relativePath = file.webkitRelativePath||file.fileName||file.name; // Some confusion in different versions of Firefox
        var size = file.size;
        return(size + '-' + relativePath.replace(/[^0-9a-zA-Z_-]/img, ''));
      },
      contains:function(array,test) {
        var result = false;

        $h.each(array, function(value) {
          if (value == test) {
            result = true;
            return false;
          }
          return true;
        });

        return result;
      },
      formatSize:function(size){
        if(size<1024) {
          return size + ' bytes';
        } else if(size<1024*1024) {
          return (size/1024.0).toFixed(0) + ' KB';
        } else if(size<1024*1024*1024) {
          return (size/1024.0/1024.0).toFixed(1) + ' MB';
        } else {
          return (size/1024.0/1024.0/1024.0).toFixed(1) + ' GB';
        }
      },
      getTarget:function(request, params){
        var target = resumableObj.getOpt('target');

        if (request === 'test' && resumableObj.getOpt('testTarget')) {
          target = resumableObj.getOpt('testTarget') === '/' ? resumableObj.getOpt('target') : resumableObj.getOpt('testTarget');
        }

        if (typeof target === 'function') {
          return target(params);
        }

        var separator = target.indexOf('?') < 0 ? '?' : '&';
        var joinedParams = params.join('&');

        return target + separator + joinedParams;
      }
    };
    return $h;
  }
  // Node.js-style export for Node and Component
  if (typeof module != 'undefined') {
    module.exports = ResumableHelpers;
  } else if (typeof define === "function" && define.amd) {
    // AMD/requirejs: Define the module
    define(function(){
      return ResumableHelpers;
    });
  } else {
    // Browser: Expose to window
    window.ResumableHelpers = ResumableHelpers;
  }
})();