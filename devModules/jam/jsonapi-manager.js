(function(){"use strict";/**
  * @ngdoc module
  * @name jsonApiManager
  */
angular
  .module('jsonApiManager', [])
  .provider('jsonApiManager', jsonapiManagerProvider)
  .constant('jamKeys', {
    VERSION_KEY: '_jamVersions',
    STORED_DATA_PREFIX: '_jamData_',
    DEFAULT_DEBOUNCE_TIME: 200
  });



/**
  * @ngdoc provider
  * @name jsonApiManagerProvider
  * @module jsonApiManager
  *
  * @description
  * Edit Base settings for all managers
  */
function jsonapiManagerProvider() {
  var provider = {
    /**
      * @ngdoc property
      * @name jsonApiManagerProvider#baseUrl
      * @module jsonApiManagerProvider
      * @description Set the base url for all calls
      */
    baseUrl: '',

    /**
      * @ngdoc property
      * @name jsonApiManagerProvider#headers
      * @module jsonApiManagerProvider
      * @description Object of base headers to be used on all calls
      */
    headers: undefined,
    $get: ['jamUtil', 'jamManager', 'jamRequest', jsonApiManagerService]
  };
  return provider;




  function jsonApiManagerService(jamUtil, jamManager, jamRequest) {
    jamRequest.baseUrl = provider.baseUrl;

    var service = {
      create: create
    };
    return service;


    /**
     * @ngdoc method
     * @name jsonApiManager#create
     * @function
     *
     * @description
     * Create a new manager
     * The manager will allow you to bind properties to data
     * it will get and format date from the server. It will automate calles to the server
     *
     * @param {object} options - object containing options you can set
     * @param {function=} callback - function to be called when manager has completed handshake with server. It will pass back any errors
     * @param {string} options.url - url for the resource
     * @param {id=} options.id - if you want to retrieve a single resource
     * @param {array=} include - Array of string values for the data you want included with resource
     *
     * @return {manager} - json api manager object
     */
    function create(options, callback) {
      validateOptions(options);

      return jamManager.create(options, callback);
    }


    function validateOptions(options) {
      if (typeof options === 'undefined') {
        throw Error('jsonApiManager.create() You must pass in options');
      }

      if (options.url === undefined) {
        throw Error('jsonApiManager.create() requires a "url" options prameter');
      }
    }
  }
}
}());
(function(){"use strict";angular
  .module('jsonApiManager')
  .factory('jamBatch', jamBatch);


jamBatch.$inject = ['jamPatch', 'jamUtil', 'jamRequest', 'jamHistory'];
function jamBatch(jamPatch, jamUtil, jamRequest, jamHistory) {
  var defineProperty = Object.defineProperty;
  var current;
  var queue = [];
  var opFormaters = {
    add: formatAdd,
    remove: formatRemove,
    replace: formatReplace
  };

  var service = {
    add: add
  };
  return service;


  function add(options, callback) {
    var patches = jamPatch.diff(options);
    if (patches.length === 0) { return; }

    var batchItems = patches.reduce(function (arr, patch) {
      var item = opFormaters[patch.op](patch, options);

      if (typeof item === 'object' && item !== null) {
        return arr.concat(item);
      }
    }, []);

    // removed dups created because of memeory referenced values
    removeDuplicates(batchItems);

    // remove refernces to values
    // these are used to create the batch items and are no longer needed
    patches.forEach(function (item) {
      delete item.valueReference;
    });

    var historyID = jamHistory.add(options.managerId, patches);
    var preVersion = jamHistory.getVersion(options.managerId);
    jamHistory.updateVersion(options.managerId);
    options.oldValue = angular.copy(options.data);

    queue.push({
      complete: false,
      running: false,
      batchItems: batchItems,
      patches: patches,
      historyID: historyID,
      previousVersion: preVersion,
      options: options,
      callback: callback
    });
    nextBatch();
  }



  // run next batch
  function nextBatch() {
    // when no current patch exists or the current batch is complete then fire the next batch if one exists
    if ((current === undefined || current.complete === true) && queue.length > 0) {
      runBatch(queue.shift());
    }
  }


  function runBatch(batch) {
    batch.running = true;

    // sort precedence form smallest to largest
    batch.batchItems.sort(function (a, b) {
      return a.precedence - b.precedence;
    });

    runRequests(batch.batchItems, false, function (error) {
      if (error !== undefined) {
        rollback(batch);

        batch.callback({
          code: 3,
          message: 'There was an error processing your batch. Your changes are being reverted',
          httpError: error
        });
        return;
      }

      batch.complete = true;
      batch.callback();
      nextBatch();
    });
  }


  function runRequests(items, reverse, callback) {
    // you have succefeully made it thorugh all requests in batch
    if (items.length === 0) {
      callback(undefined);
      return;
    }

    var errors = [];
    var rollback = false;
    var callcount = 0;
    var counted = 0;
    var precedence = items[0].precedence;

    items.filter(function (item) {
      return item.precedence === precedence;
    }).forEach(function (item) {
      callcount += 1;

      jamRequest.sendBatchItem(item, reverse, function (error, response) {
        if (error !== undefined) {
          rollback = true;
          item.success = false;
          errors.push(error);
        } else { item.success = true; }

        counted += 1;
        if (callcount === counted) {
          // roll back if any call encounters an error
          // NOTE currently no error will be promoted if a call fails on call reversal
          if (reverse === false && rollback === true) {
            callback(errors);
            return;
          }


          // call self and and pass array with only higher priorites
          runRequests(items.filter(function (item) {
            if (reverse === true) {
              return item.precedence < precedence;
            } else {
              return item.precedence > precedence;
            }
          }), reverse, callback);
        }
      });
    });
  }



  // --- Rollback Batch and remove -----
  function rollback(batch) {
    var revertItems = batch.batchItems.filter(function (item) {
      if (item.success === true) {
        return true;
      }
      return false;
    });

    // sort precedence form largest to smallest
    revertItems.sort(function (a, b) {
      return b.precedence - a.precedence;
    });

    runRequests(revertItems, true, function () {
      jamHistory.undo(batch.options, batch.historyID);
      batch.complete = true;
      nextBatch();
    });
  }







  function formatAdd(patch, options) {
    var value;
    var request = [];
    var typescope = jamUtil.getTypeScope(patch.path, patch.type, options.typescopes);

    if (patch.type === undefined || patch.newItem === true) {
      patch.type = typescope.type;
      patch.newItem = true;

      // generate id if none exists
      if (patch.value.id === undefined) { patch.value.id = jamUtil.getId(); }

      // NOTE if the item was created then we need to add a typescope to it
      if (patch.valueReference !== undefined) {
        if (patch.valueReference.id === undefined) { patch.valueReference.id = patch.value.id; }

        // add the typescope
        defineProperty(patch.valueReference, 'typescope', {
          enumerable: false,
          configurable: false,
          writable: false,
          value: typescope
        });
      }

      // set relationships that are toMany(array) as empty arrays
      jamUtil.defaultRelationships(patch.valueReference, patch.valueReference.typescope.relationships);

      // if the item created is not the top layer then add it to the includes
      if (typescope.type !== options.typescopes[0].type) { addInclude(patch.valueReference, options.included); }
    }


    // create value object or assign property
    // patch.singleResource is added if an object is replaced
    if (patch.prop === undefined || patch.singleResource === true) {
      value = patch.value;
    } else {
      value = {};
      value[patch.prop] = patch.value;
    }

    // if item is child of a typescope then treat is as a relationship

    /**
      * TODO figure out how to handle not calling the relationship on add, this setup seems to work
      * NOTE cases to add relationship calls
      * - new item and no constraint
      * - existing item that is toMany(should disallow this)
      * - check for parent id existance(no parent id will exist for top layer object)
      */

    if (patch.parentId !== undefined && typescope.constraint === undefined) {
      request.push({
        op: 'relationship',
        url: typescope.parentScope.url + '/' + patch.parentId + '/relationships/' + typescope.url,
        toMany: typescope.toMany || false,
        data: {
          type: typescope.type,
          id: value.id
        },
        oldData: {
          type: typescope.type,
          id: value.id
        },
        // NOTE set at 1000 with the assumption there will not be scopping that deep
        precedence: 1000 // 1000 for update calls. smallest first
      });
    }


    // create add request
    if (patch.newItem === true) {
      request.push({
        op: 'add',
        url: typescope.url + '/' + value.id,
        type: typescope.type,
        data: value,
        parentId: patch.parentId,
        constraint: typescope.constraint,
        precedence: getPrecedence(typescope, 0) // precedence for add calls. smallest first
      });
    }

    return request;
  }


  function formatRemove(patch, options) {
    var request = [];
    var typescope = jamUtil.getTypeScope(patch.path, patch.type, options.typescopes);


    // TODO figure out casses to send a remove relation request
    // if item is child of a typescope then treat is as a relationship
    if (patch.parentId !== undefined && typescope.constraint === undefined && typescope.toMany === true) {
      request.push({
        op: 'removeRelationship',
        url: typescope.parentScope.url + '/' + patch.parentId + '/relationships/' + typescope.prop + '/' + patch.id,
        data: {
          type: typescope.type,
          id: patch.id
        },
        oldData: {
          type: typescope.type,
          id: patch.id
        },
        // NOTE set at 1000 with the assumption there will not be scopping that deep
        precedence: 1000 // 1000 for update calls. smallest first
      });
    }

    request.push({
      op: 'remove',
      url: typescope.urls + '/' + patch.id,
      oldData: angular.copy(patch.oldData),
      parentId: patch.parentId,
      constraint: typescope.constraint,
      precedence: getPrecedence(typescope, 0) // precedence for add calls. smallest first
    });

    return request;
  }


  function formatReplace(patch, options) {
    var value;
    var oldData;
    var typescope = jamUtil.getTypeScope(patch.path, patch.type, options.typescopes);

    // TODO create better path for single object creation
    // if no typscope exists then we assume the abject is new and will create a add request insteat
    // the case where this will not apply is when adding an existing obj to a new relation
    if (patch.type === undefined && typescope !== undefined) {
      patch.type = typescope.type;
      patch.newItem = true;
      patch.singleResource = true;
      patch.parentId = patch.id;
      return getAddRequest(patch, options);
    }


    // get value as object
    if (patch.prop === undefined || patch.prop === '') {
      value = angular.copy(patch.value);
      oldData = angular.copy(patch.oldData);

    // get value as property
    } else {
      value = {};
      value[patch.prop] = patch.value;
      oldData = {};
      oldData[patch.prop] = patch.oldData;
    }

    // add id to value object
    value.id = patch.id;
    oldData.id = patch.id;

    return {
      op: 'replace',
      url: typescope.url + '/' + patch.id,
      type: patch.type,
      data: value,
      oldData: oldData,
      precedence: 1000 // 1000 for update calls. smallest first
    };
  }





  function addInclude(obj, includes) {
    if (includes[obj.typescope.type] === undefined) {
      includes[obj.typescope.type] = [];
    }

    includes[obj.typescope.type].push(obj);
  }



  // Get precedence based on typescopes
  function getPrecedence(typescope, count) {
    if (typescope === undefined) { return count; }
    var parent = typescope.parentScope;

    while (parent !== undefined) {
      count += 1;
      parent = getScopeParent(parent);
    }

    return count;
  }

  function getScopeParent(typescope) {
    return typescope.parentScope;
  }



  // remove duplicated from request objects
  // duplicates are created because of the object memeory reference
  function removeDuplicates(arr) {
    var i = 1;
    var length = arr.length;

    // sort array on url first and op second
    arr.sort(function (a, b) {
      if (a.url < b.url) { return -1; }
      if (a.url > b.url) { return 1; }
      if (a.op < b.op) { return -1; }
      if (a.op > b.op) { return 1; }
      return 0;
    });

    // remove dups
    while (i < length) {
      if (angular.equals(arr[i-1], arr[i]) === true) {
        arr.splice(i, 1);
      } else {
        i += 1;
      }
    }
  }
}
}());
(function(){"use strict";angular
  .module('jsonApiManager')
  .factory('jamHandshaker', jamHandshaker);


jamHandshaker.$inject =['jamRequest', 'jamHistory', 'jamKeys', 'jamUtil'];
function jamHandshaker(jamRequest, jamHistory, jamKeys, jamUtil) {
  var service = {
    synchronize: synchronize,
    recheck: recheck
  };
  return service;



  function synchronize(options, callback) {
    var handshakeHeaders;
    var url = options.url;
    var version = jamHistory.getVersion(options.managerId);



    // fake header call fi skipHandshake is passed as true
    if (options.skipHandshake === true) {
      jamHistory.clearVersions(options.managerId);
      jamHistory.newVersion(options.managerId);
      jamHistory.clear(options.managerId);
      options.isVersioning = false; // tell manager there is no versioning
      options.getNewData = true; // tell manager it needs to get new data
      getStructure(options, callback);
      return;
    }



    // if no version exists then data must have been cleared
    // Remvoe any info to be safe and create a new version
    // this will garentee we get new data from server
    if (version === undefined) {
      jamHistory.clear(options.managerId);
      version = jamHistory.newVersion(options.managerId);
    }

    if (version !== undefined) {
      handshakeHeaders = {
        'jam-handshake': true,
        'jam-version': version.date
      };
    } else {
      handshakeHeaders = {
        'jam-handshake': true
      };
    }

    jamRequest.head(url, handshakeHeaders, function (error, response, headers) {
      if (error !== undefined) {
        callback({
          code: '1',
          message: 'jsonApiManager was not able to complete handshake',
          httpError: error
        });
        return;
      }

      var isVersioning = headers('jam-versioning') === 'true' ? true : false;
      var getUpdate = isVersioning === false ? true : headers('jam-no-updates') === 'true' ? false : true;

      // if ther is no versioning or there are updates, then clear history
      // also create a new version for cache busting
      if (getUpdate === true) {
        jamHistory.clearVersions(options.managerId);

        // TODO pass in date from server for creation of new version
        jamHistory.newVersion(options.managerId);
        jamHistory.clear(options.managerId);
      }

      options.isVersioning = isVersioning; // tell manager there is no versioning
      options.getNewData = getUpdate; // tell manager it needs to get new data
      getStructure(options, callback);
    });
  }



  // this call is simaler to the synchronize call but it will not modify any data
  function recheck(options, callback) {
    var handshakeHeaders;
    var url = options.url;
    var version = jamHistory.getVersion(options.managerId);

    if (version !== undefined) {
      handshakeHeaders = {
        'jam-handshake': true,
        'jam-version': version.date
      };
    } else {
      handshakeHeaders = {
        'jam-handshake': true
      };
    }

    jamRequest.head(url, handshakeHeaders, function (error, response, headers) {
      if (error !== undefined) {
        callback({
          code: '1',
          message: 'jsonApiManager was not able to complete handshake',
          httpError: error
        });
        return;
      }

      var isVersioning = headers('jam-versioning') === 'true' ? true : false;
      var getUpdate = isVersioning === false ? true : headers('jam-no-updates') === 'true' ? false : true;

      // if ther is no versioning or there are updates, then clear history
      // also create a new version for cache busting
      if (getUpdate === false) {
        callback(undefined);
        return;
      }

      jamHistory.clearVersions(options.managerId);
      // TODO pass in date from server for creation of new version
      jamHistory.newVersion(options.managerId);

      options.isVersioning = isVersioning; // tell manager there is no versioning
      options.getNewData = getUpdate; // tell manager it needs to get new data
      getStructure(options, callback, true);
    });
  }



  // get data structure from server
  // if passBack is set to true then send the typscopes back instead of setting them, this is so the current data is not distrupted
  function getStructure(options, callback, passBack) {
    var versionCacheBust = jamHistory.getVersion(options.managerId);


    // if structure is passed in then don't get from server
    if (typeof options.structure === 'object' && options.structure !== null) {
      if (passBack !== true) {
        options.typescopes = jamUtil.buildTypeScopes(options, options.structure);
        callback(undefined);
      } else {
        callback(undefined, true, jamUtil.buildTypeScopes(options, options.structure));
      }

      return;
    }


    jamRequest.get(jamUtil.getCacheBustUrl(options.getUrl, versionCacheBust.cb), {'jam-get-structure': true}, function (error, response, headers) {
      if (error !== undefined) {
        callback({
          code: '2',
          message: 'jsonApiManager was not able to get data structur',
          httpError: error
        });
        return;
      }

      if (passBack !== true) {
        options.typescopes = jamUtil.buildTypeScopes(options, response);
        callback(undefined);
      } else {
        callback(undefined, true, jamUtil.buildTypeScopes(options, response));
      }
    });
  }
}
}());
(function(){"use strict";angular
  .module('jsonApiManager')
  .factory('jamHistory', jamHistory);


jamHistory.$inject = ['jamUtil', 'jamStorage', 'jamKeys', 'jamPatch'];
function jamHistory(jamUtil, jamStorage, jamKeys, jamPatch) {
  var service = {
    add: add,
    undo: undo,
    clear: clear,
    clearVersions: clearVersions,
    getVersion: getVersion,
    newVersion: newVersion,
    updateVersion: updateVersion,
    rollbackToVersion: rollbackToVersion
  };
  return service;


  function add(id, data) {
    var storedItem = jamStorage.get(jamKeys.STORED_DATA_PREFIX + id) || [];
    var date = jamUtil.now();

    storedItem.push({data: data, date: date});
    jamStorage.set(jamKeys.STORED_DATA_PREFIX + id, storedItem);

    return date;
  }



  // clear all previos version data for given manager id
  // this should onyl be run if new info is going to be retrived from the server
  // a new version should be created after this
  function clearVersions(id) {
    jamStorage.remove(jamKeys.VERSION_KEY + id);
  }

  // return last version
  function getVersion(id) {
    var versionData = jamStorage.get(jamKeys.VERSION_KEY + id);
    return versionData ? versionData[versionData.length - 1] : undefined;
  }

  // create and add new version
  function newVersion(id) {
    var versionData = jamStorage.get(jamKeys.VERSION_KEY + id) || [];
    var version = {
      date: jamUtil.now(),
      cb: jamUtil.now()
    };
    versionData.push(version);
    jamStorage.set(jamKeys.VERSION_KEY + id, versionData);
    return version;
  }


  // TODO may want to add another on update so it will be easier to rollback to previus caches
  // find last verion and update its cache buster
  // ypu can also pass in a specific date
  function updateVersion(id, date) {
    var version;
    var versionData = jamStorage.get(jamKeys.VERSION_KEY + id) || [];
    date = date || versionData[versionData.length - 1].date;

    versionData.every(function (item) {
      if (item.data === date) {
        item.date = jamUtil.now();
        version = item;
        return false;
      }
      return true;
    });

    jamStorage.set(jamKeys.VERSION_KEY + id, versionData);
    return version;
  }

  // romove all versions after a certain date
  function rollbackToVersion(id, date) {
    var versionData = jamStorage.get(jamKeys.VERSION_KEY + id) || [];

    // filter out any version greater the set one
    versionData = versionData.filter(function (item) {
      return parseInt(item.date) <= parseInt(date);
    });

    jamStorage.set(jamKeys.VERSION_KEY + id, versionData);
    return versionData[versionData.length - 1];
  }



  function undo(options, date) {
    // extract patches
    var removed = undoHistory(options.managerId, date).map(function (item) {
      return item.data;

    // flatten patches
    }).reduce(function (arr, item) {
      return arr.concat(item);

    // reverse patches
    }).map(function (item) {
      return jamUtil.reversePatch(item);

    // reverse patch order
    }).reverse();
    // apply patched and set oldvalue
    jamPatch.apply(options.data, removed);
    jamUtil.removeIncludes(removed, options.included);
    options.oldValue = angular.copy(options.data);
  }



  // remove item from history based on date
  function undoHistory(id, date) {
    var removed = [];
    var storedItem = jamStorage.get(jamKeys.STORED_DATA_PREFIX + id) || [];

    if (storedItem.length === 0) { return; }

    // NOTE Should i mark items for undo instead of removing them? The benefit of removing it is memory conservation.
    //      the problem with removing items is not being able to redo
    if (date === undefined) {
      removed = storedItem.splice(storedItem.length - 1, 1);
    } else {
      storedItem = storedItem.filter(function (item) {
        if (item.date === date) {
          removed.push(item);
          return false;
        } else { return true; }
      });
    }

    jamStorage.set(jamKeys.STORED_DATA_PREFIX + id, storedItem);
    return removed;
  }



  function clear(id) {
    jamStorage.remove(jamKeys.STORED_DATA_PREFIX + id);
  }
}
}());
(function(){"use strict";angular
  .module('jsonApiManager')
  .factory('jamJsonApi', jamJsonApi);


jamJsonApi.$inject = ['jamUtil'];
function jamJsonApi(jamUtil) {
  var getKeys = Object.keys;
  var freeze = Object.freeze;
  var defineProperty = Object.defineProperty;

  var service = {
    parse: parse,
    format: format,
    combineData: combineData
  };
  return service;



  function combineData(oldData, newData, singleResource) {
    var combinedData = {};

    if (oldData === undefined) {
      if (singleResource !== true && !(newData.data instanceof Array)) {
        newData.data = newData.data === null ? [] : [angular.copy(newData.data)];
      }

      return newData;
    }

    // combine data
    if (oldData.data instanceof Array || newData.data instanceof Array) {
      combinedData.data = combineToArray(oldData.data, newData.data);
    } else {
      combinedData.data = combineToObject(oldData.data, newData.data);
    }

    if (singleResource !== true && !(combinedData.data instanceof Array)) {
      combinedData.data = combinedData.data === null ? [] : [angular.copy(combinedData.data)];
    }

    // combine included data
    combinedData.included = combineToArray(oldData.included, newData.included);

    return combinedData;
  }


  function combineToObject(oldData, newData) {
    if (oldData === null) { return newData; }
    if (newData === null) { return oldData; }

    if (oldData.id === newData.id) {
      return newData;
    } else {
      var arr = [];
      arr.push(oldData, newData);
      return arr;
    }
  }


  function combineToArray(oldData, newData) {
    if (oldData === undefined || oldData === null || oldData.length === 0) {
      if (newData === undefined || newData === null) { return []; }
      else { return [].concat(newData); }
    }
    if (newData === undefined || newData === null) { return oldData; }


    var i;
    var combinedArray = [].concat(oldData).concat(newData);
    var index = 0;
    var length = combinedArray.length;

    combinedArray = combinedArray.filter(function (item) {
      index += 1;
      i = index;
      while (i < length) {
        if (item.id === combinedArray[i].id) {
          return false;
        }

        i += 1;
      }

      return true;
    });

    return combinedArray;
  }



  // --- format ---------------------
  // --------------------------------

  function format(data, type, op, constraint, parentId) {
    op = op || 'add';
    var obj = {};

    if (op === 'add' || op === 'replace') {
      obj.data = {
        id: data.id,
        type: type,
        attributes: angular.copy(data)
      };

      if (obj.data.attributes.id !== undefined) {
        delete obj.data.attributes.id;
      }

    } else if (op === 'relationship' || op === 'removeRelationship') {
      obj.data = angular.copy(data);
    }

    if (constraint !== undefined) {
      obj.meta = {
        constraint: {
          id: parentId,
          resource: constraint
        }
      };
    }

    return obj;
  }





  // --- Parse ----------------------
  // --------------------------------

  function parse(payload, typeScopes) {
    if (payload.data === null || (payload.data instanceof Array && payload.data.length === 0)) {
      return {
        data: payload.data === null ? null : [],
        included: {}
      };
    }

    var included = organizeIncluded(payload.included, typeScopes);

    return {
      data: buildData(payload.data, payload.included, included, typeScopes),
      included: included
    };
  }


  function organizeIncluded(data, typeScopes) {
    var i;
    var length;
    var included;
    var type;
    var obj;
    var relationshipKeys;
    var relationshipKey;

    if (data === undefined) { return undefined; }

    included = {};
    i = 0;
    length = data.length;

    while (i < length) {
      type = data[i].type;

      if (included[type] === undefined) {
        included[type] = [];
      }

      obj = { id: data[i].id };
      defineProperty(obj, 'typescope', {
        enumerable: false,
        configurable: false,
        writable: false,
        value: getTypescope(type, typeScopes)
      });

      // set relationships that are toMany(array) as empty arrays
      jamUtil.defaultRelationships(obj, obj.typescope.relationships);

      included[type].push(angular.extend(obj, data[i].attributes));

      i++;
    }

    return included;
  }

  function getTypescope(type, typeScopes) {
    if (typeScopes === undefined) { return undefined; }

    var i = 0;
    var length = typeScopes.length;

    while (i < length) {
      if (typeScopes[i].type === type) {
        return typeScopes[i];
      }

      i += 1;
    }

    return undefined;
  }






  // --- Build Data ---------------
  // buildData(payload.data, payload.included, included, typeScopes);
  function buildData(data, payloadIncluded, includes, typeScopes, obj) {
    var popped;
    var relationshipKeys;
    var relationshipKey;
    var isArray = (data instanceof Array);
    if (obj === undefined && isArray === true) {
      obj = [];
    }

    // loop through data array
    if (isArray === true && data.length === 0) { return []; }
    if (isArray === true) {
      popped = data.pop();
      while (popped !== undefined) {
        obj.push(buildData(popped, payloadIncluded, includes, typeScopes));
        popped = data.pop();
      }

    // link object to attrs
    } else {
      obj = data.attributes || {};

      // if no id then assume there is no data
      if (data.id !== undefined) {
        obj.id = data.id;
        defineProperty(obj, 'typescope', {
          enumerable: false,
          configurable: false,
          writable: false,
          value: getTypescope(data.type, typeScopes)
        });

        // set relationships that are toMany(array) as empty arrays
        jamUtil.defaultRelationships(obj, obj.typescope.relationships);

        // link relationships
        getRelationships(obj, data.relationships, payloadIncluded, includes);
      }
    }

    return obj;
  }



  function getRelationships(obj, relationships, payloadIncluded, includes) {
    obj = obj || {};
    relationships = relationships || {};

    getKeys(relationships).forEach(function (key) {
      obj[key] = getRelationship(relationships[key], payloadIncluded, includes);
    });
  }

  function getRelationship(relationship, payloadIncluded, includes) {
    var obj;
    var isArray;
    var origSubObj;

    if (relationship === undefined || relationship.data === undefined) { return undefined; }
    if (relationship.data === null) { return null; }

    isArray = (relationship.data instanceof Array);
    if (isArray === false && getKeys(relationship.data).length === 0) { return {}; }
    if (isArray === true && relationship.data.length === 0) { return []; }

    if (isArray === true) {
      obj = [];
      relationship.data.forEach(function (item) {
        var subobj = getIncluded(item, includes);
        origSubObj = getOriginalIncluded(item, payloadIncluded);
        getRelationships(subobj, origSubObj.relationships, payloadIncluded, includes);
        obj.push(subobj);
      });

    } else {
      obj = getIncluded(relationship.data, includes);
      origSubObj = getOriginalIncluded(relationship.data, payloadIncluded);
      getRelationships(obj, origSubObj.relationships, payloadIncluded, includes);
    }

    return obj;
  }

  function getIncluded(data, includes) {
    var i = 0;
    var includeByType = includes[data.type] || [];
    var length = includeByType.length;

    while (i < length) {
      if (includeByType[i].id === data.id) {
        return includeByType[i];
      }
      i++;
    }

    return null;
  }

  function getOriginalIncluded(data, includes) {
    includes = includes || [];
    var i = 0;
    var length = includes.length;

    while (i < length) {
      if (includes[i].id === data.id && includes[i].type === data.type) {
        return includes[i];
      }
      i++;
    }

    return null;
  }
}
}());
(function(){"use strict";angular
  .module('jsonApiManager')
  .factory('jamPatch', jamPatch);


function jamPatch() {
  var service = {
    diff: diff,
    apply: apply
  };
  return service;


  function diff(options, reverse) {
    var patches = [];

    if (reverse === true) {
      generatePataches(angular.copy(options.data), options.oldValue, patches, '');
    } else {
      generatePataches(angular.copy(options.oldValue), options.data, patches, '');
    }
    return patches;
  }



  function generatePataches(oldValue, newValue, patches, path, parentId) {
    var i;
    var j;
    var lengthDiff;
    var oldKey;
    var newKey;
    var isObj;
    var deleted;
    var newObj;
    var oldObj;
    var key;
    var typescope;
    var prop;

    var newKeys = _objectKeys(newValue);
    var oldKeys = _objectKeys(oldValue);
    var oldLength = oldKeys.length;
    var newLength = newKeys.length;



    // --- Adds  / Removals ---

    // if lengths are different then there was additions/removals
    if (oldLength !== newLength) {
      lengthDiff = Math.abs(oldLength - newLength);


      // Check for removals
      i = 0;
      while (i < oldLength) {
        oldKey = oldKeys[i];
        i += 1;

        oldObj= oldValue[oldKey];
        // skip to next item if this one no longer exists
        if (oldObj === undefined) { continue; }

        isObj = typeof oldObj === 'object' && oldObj !== null;
        deleted = true; // if oldObj exists in newValue then this will be set to true
        j = 0;

        while (j < newLength) {
          newKey = newKeys[j];
          j += 1;

          newObj = newValue[newKey];


          // TODO : fix this if check so if the old length is greater than the new it still checks all items in list for deletion
          //        To replicate this issue add a new object then remove the first object

          // check objects with ids
          if (isObj === true && oldObj.id !== undefined && typeof newObj === 'object' && newObj.id !== undefined) {
            if (oldObj.id === newObj.id) {
              deleted = false;
              break;
            }

          // check for non object values
          // NOTE : these will be assumed to sit nested inside of an object with an id
          } else if (oldObj === null && (typeof newObj === 'object' && newObj !== null)) {
            break;

          } else {
            deleted = false;
          }
        }

        if (deleted === true) {
          lengthDiff -= 1;

          // NOTE : may need to check if is and abject and use delete

          // remove object/key and set the length and counter back
          if (oldValue instanceof Array) {
            oldValue.splice(parseInt(oldKey), 1);
          } else {
            delete oldValue[oldKey];
          }
          oldKeys.splice(i, 1);
          i -= 1;
          oldLength -= 1;


          if (typeof oldObj === 'object' && oldObj !== null) {
            typescope = oldObj.typescope;
          } else if (typescope !== undefined) { typescope = undefined; }


          patches.push({
            op: 'remove',
            path: path + '/' + escapePath(oldKey),
            id: oldObj.id !== undefined ? oldObj.id : undefined,
            type: typescope !== undefined ? typescope.type : undefined,
            oldData: deepClone(oldObj),
            parentId: newValue instanceof Array ? parentId : newValue.id
          });
        }
      }


      // Check for additions
      if (lengthDiff > 0) {
        i = 0;

        while (i < newLength) {
          key = newKeys[i];
          i += 1;

          if (oldValue[key] === undefined) {
            newObj = newValue[key];

            if (newObj instanceof Array) {
              typescope = undefined;
              prop = escapePath(key);
            } else if (typeof newObj === 'object' && newObj !== null) {
              typescope = newObj.typescope;
              prop = undefined;
            } else {
              patches.push({
                op: 'replace',
                path: path + '/' + escapePath(key),
                value: deepClone(newObj),
                valueReference: newObj,
                id: newValue.id !== undefined ? newValue.id : undefined,
                type: newValue.typescope !== undefined ? newValue.typescope.type : undefined,
                prop: escapePath(key),
                oldData: deepClone(oldObj),
                parentId: parentId
              });
              break;
            }

            patches.push({
              op: 'add',
              path: path + '/' + escapePath(key),
              value: deepClone(newObj),
              prop: prop,
              type: typescope !== undefined ? typescope.type : undefined,
              parentId: newValue instanceof Array ? parentId : newValue.id,
              valueReference: newObj
            });
          }
        }
      }
    }


    // --- Replaces---
    // NOTE : if an object is spliced in then middle of an array, this may disrupt the replaces

    i = 0;
    while (i < oldLength) {
      key = oldKeys[i];
      i += 1;

      oldObj = oldValue[key];
      if (newValue[key] !== undefined) {
        newObj = newValue[key];

        if (typeof oldObj === 'object' && oldObj !== null && typeof oldObj === 'object' && oldObj !== null) {
          // if the old value is an array then an aditional recursion will happend so we need to pass througth the previos parentId
          generatePataches(oldObj, newObj, patches, path + '/' + escapePath(key), oldValue instanceof Array ? parentId : oldValue.id);

        // values are not strictly equal
        } else if (oldObj !== newObj) {
          patches.push({
            op: 'replace',
            path: path + '/' + escapePath(key),
            value: deepClone(newObj),
            valueReference: newObj,
            id: newValue.id !== undefined ? newValue.id : undefined,
            type: newValue.typescope !== undefined ? newValue.typescope.type : undefined,
            prop: escapePath(key),
            oldData: deepClone(oldObj),
            parentId: parentId
          });
        }
      }
    }
  }






  // --- Apply Patches -----------


  function apply(data, patches) {
    var patch;
    var path;
    var keys;
    var key;
    var obj;
    var j;
    var keyLength;
    var existingPathFragment;

    var result = false;
    var i = 0;
    var length = patches.length;

    while (i < length) {
      patch = patches[i];
      i += 1;

      path = patch.path || '';
      keys = path.split('/');
      obj = data;
      j = 1;
      keyLength = keys.length;
      existingPathFragment = undefined;


      while (true) {
        key = keys[j];
        j += 1;

        
        if (obj === undefined) {
          break;
        }


        if (key === undefined && j >= keyLength) {
          if (patch.op === 'replace') {
            result = rootReplace(obj, patch.value, patch.path);
          } else if (patch.op === 'add') {
            result = rootAdd(obj, patch.value);
          } else if (patch.op === 'remove') {
            result = rootRemove(obj);
          }

          break;
        }



        if (obj instanceof Array) {
          if (key === '-') {
            key = obj.length;
          } else {
            key = parseInt(key, 10);
          }

          if (j >= keyLength) {
            if (patch.op === 'replace') {
              result = arrReplace(obj, key, patch.value);
            } else if (patch.op === 'add') {
              result = arrAdd(obj, key, patch.value);
            } else if (patch.op === 'remove') {
              result = arrRemove(obj, key);
            }

            break;
          }


        } else {
          if (key && key.indexOf('~') !== -1) {
            key = key.replace(/~1/g, '/').replace(/~0/g, '~'); // un-escape chars
          }

          if (j >= keyLength) {
            if (patch.op === 'replace') {
              result = objAddReplace(obj, key, patch.value);
            } else if (patch.op === 'add') {
              result = objAddReplace(obj, key, patch.value);
            } else if (patch.op === 'remove') {
              result = objRemove(obj, key);
            }

            break;
          }
        }

        obj = obj[key];
      }
    }

    return result;
  }


  // --- root functions -------

  function rootAdd(obj, value) {
    var i = 0;
    var keys = _objectKeys(value);
    var length = keys.length;
    rootRemove(obj);

    while (i < length) {
      key = keys[i];
      i += 1;

      obj[key] = value[key];
    }

    return true;
  }

  function rootRemove(obj) {
    var i = 0;
    var keys = _objectKeys(obj);
    var length = keys.length;

    while (i < length) {
      key = keys[i];
      i += 1;

      objRemove(obj, key);
    }

    return true;
  }

  function rootReplace(obj, value, path) {
    apply(obj, [
      { op: "remove", path: path }
    ]);

    apply(obj, [
      { op: "add", path: path, value: value }
    ]);

    return true;
  }



  // --- obj functions -------

  function objAddReplace(obj, key, value) {
    obj[key] = value;
    return true;
  }

  function objRemove(obj, key) {
    delete obj[key];
    return true;
  }


  // -- array functions ---

  function arrAdd(arr, i, value) {
    arr.splice(i, 0, value);
    return true;
  }

  function arrRemove(arr, i) {
    arr.splice(i, 1);
    return true;
  }

  function arrReplace(arr, i, value) {
    arr[i] = value;
    return true;
  }






  // --- escpae path ~, / ---
  function escapePath(str) {
    if (str.indexOf('/') === -1 && str.indexOf('~') === -1) {
      return str;
    }
    return str.replace(/~/g, '~0').replace(/\//g, '~1');
  }


  // --- Deep Clone using JSON ---

  function deepClone(obj) {
    if (typeof obj === 'object') {
      // NOTE may need to add a date reciever
      return JSON.parse(JSON.stringify(obj));
    } else {
      return obj; //no need to clone primitives
    }
  }





  // --- Get keys for object or array ---

  function _objectKeys(obj) {
    var i;
    var length;
    var keys;
    var hashIndex;

    if (obj instanceof Array) {
      i = 0;
      length = obj.length;
      keys = new Array(length);

      while (i < length) {
          keys[i] = i.toString();
          i++;
      }

      return keys;
    }

    keys = Object.keys(obj);
    hashIndex = keys.indexOf('$$hashKey');
    if (hashIndex > -1) { keys.splice(hashIndex, 1); }

    return keys;
  }
}
}());
(function(){"use strict";/**
  * @ngdoc module
  * @name Manager
  * @description
  * Object returned when you call created
  */
angular
  .module('jsonApiManager')
  .factory('jamManager', jamManager);


jamManager.$inject =['jamHandshaker', 'jamRequest', 'jamUtil', 'jamJsonApi', 'jamStorage', 'jamKeys', 'jamBatch', 'jamHistory', 'jamPatch'];
function jamManager(jamHandshaker, jamRequest, jamUtil, jamJsonApi, jamStorage, jamKeys, jamBatch, jamHistory, jamPatch) {
  var service = {
    create: create
  };
  return service;



  function create(options, errorCallback) {
    options.getUrl = createGetUrl(options.url, options.id, options.include);
    // create hex hash; used to refernce this manger
    options.managerId = jamUtil.hashString(options.getUrl);

    var manager = constructManager(options);

    // maek handshake with server and get structure data to build typescopes
    jamHandshaker.synchronize(options, function (error) {
      if (error !== undefined) {
        errorCallback(error);
        options.errored = true;
        return;
      }

      options.ready = true;
      manager.$$init();
    });

    return manager;
  }

  function createGetUrl(url, id, include) {
    var getUrl = url;
    if (id !== undefined) { getUrl += '/' + id; }
    if (include instanceof Array && include.length > 0) {
      getUrl += '?include=' + include.join(',');
    }

    return getUrl;
  }


  function constructManager(options) {
    var inited = false;
    var waitingToGet = false;
    var waitingToGetId;
    var dataRetrieved = false;
    var watingGetCallback;
    var watingGetIdCallback;
    var watchers = {};
    var watcherId = 1;

    var bindings = [];


    var service = {
      $$init: init,
      get: get,
      getById: getById,
      bind: bind,
      unbind: unbind,
      registerScope: registerScope,
      applyChanges: applyChanges,
      removeChanges: removeChanges,
      watch: watch,
      destroy: destroy
    };
    return service;



    function init() {
      // defualt the data and includes so bindings can run
      options.data = options.id ? {} : [];
      options.oldValue = options.id ? {} : [];
      options.included = {};

      inited = true;
      if (waitingToGet === true) {
        get(watingGetCallback);
        waitingToGet = false;
      } else if (waitingToGetId !== undefined) {
        getById(waitingToGetId, watingGetIdCallback);
        waitingToGetId = undefined;
      } else {
        updateAllBindings();
      }
    }





    // --- Get Data -----

    /**
     * @ngdoc method
     * @name Manager#get
     * @function
     *
     * @description
     * get data from server
     * if you call this more than once it will only get new data
     *
     * @param {function=} callback - function to be called when data is recieved. It will pass back any errors
     */
    function get(callback) {
      callback = callback || angular.noop;

      if (inited === false) {
        waitingToGet = true;
        watingGetCallback = callback;
        return;
      }

      if (dataRetrieved === false) {
        getData(callback);
      } else {
        reGet(callback);
      }
    }


    function getById(id, callback) {
      callback = callback || angular.noop;

      if (options.id !== undefined) {
        throw Error('jsonApiManager.getById() You can only get a resource by id if you did not specify one in the create options');
      }

      if (inited === false) {
        waitingToGetId = id;
        watingGetIdCallback = callback;
        return;
      }


      if (dataRetrieved === false) {
        getDataById(id, callback);
      } else {
        reGet(callback, id);
      }
    }

    function getDataById(id, callback) {
      var getUrl = createGetUrl(options.url, id, options.include);
      var version = jamHistory.getVersion(options.managerId); // version is handled during handshake

      jamRequest.get(jamUtil.getCacheBustUrl(getUrl, version.cb + '_data'), function (error, response) {
        if (error !== undefined) {
          callback(error);
          options.errored = true;
          return;
        }

        var combinedResponse = jamJsonApi.combineData(options.original, response, options.id !== undefined);

        options.original = angular.copy(combinedResponse);
        var parsedJsonApi = jamJsonApi.parse(combinedResponse, options.typescopes);

        // NOTE i may need to do a seperate check for changes
        if (options.getNewData === false || dataRetrieved === true) {
          var patches = jamUtil.getPatches(options.managerId);
          if (patches !== undefined) {
            jamPatch.apply(parsedJsonApi.data, patches);
          }
        }


        options.data = parsedJsonApi.data;
        options.oldValue = angular.copy(parsedJsonApi.data);
        options.included = parsedJsonApi.included || {};

        options.ready = true;
        updateAllBindings();

        callback(undefined, parsedJsonApi.data);
      });
    }


    function getData(callback, _typscopes) {
      var url = options.getUrl;
      var version = jamHistory.getVersion(options.managerId); // version is handled during handshake

      jamRequest.get(jamUtil.getCacheBustUrl(options.getUrl, version.cb + '_data'), function (error, response) {
        if (error !== undefined) {
          callback(error);
          options.errored = true;
          return;
        }

        dataRetrieved = true;
        if (_typscopes !== undefined) {
          options.typescopes = _typscopes;
          jamHistory.clear(options.managerId);
        }
        options.original = angular.copy(response);
        var parsedJsonApi = jamJsonApi.parse(response, options.typescopes);


        if (options.getNewData === false) {
          var patches = jamUtil.getPatches(options.managerId);
          if (patches !== undefined) {
            jamPatch.apply(parsedJsonApi.data, patches);
          }
        }

        options.data = parsedJsonApi.data;
        options.oldValue = angular.copy(parsedJsonApi.data);
        options.included = parsedJsonApi.included || {};

        options.ready = true;
        updateAllBindings();

        callback(undefined, options.data);
      });
    }


    // make head call to se if ther is new data from server
    // only make get call if server is not versioning or the server specifies that it has new data
    function reGet(callback, byId) {
      jamHandshaker.recheck(options, function (error, newData, typescopes) {
        if (error !== undefined) {
          errorCallback(error);
          options.errored = true;
          return;
        }

        if (newData === true) {
          if (byId !== undefined) {
            getDataById(byId, callback);
          } else {
            getData(callback, typescopes);
          }
        } else {
          callback(undefined, options.data);
        }
      });
    }






    // --- Bind variables ----

    /**
     * @ngdoc method
     * @name Manager#bind
     * @function
     *
     * @description
     * Bind data to property of an object
     * You can optionally pass in a type to get all of a given type
     * You can optionally pass in a id to get one of a given type
     *
     * @param {object} object - object that you will bind properties to. This will most likley be the scope or controller
     * @param {string} property - string name of property to set variable on
     * @param {string=} type - Pass in type name to get all of that type
     * @param {string=} id - pass in an id to get a single object of a given type
     */
    function bind(obj, property, type, id) {
      if (typeof obj !== 'object' || obj === null) {
        throw Error('jsonApipManager.bind() requires a object to be passed in as the first parameter');
      }

      if (typeof property !== 'string') {
        throw Error('jsonApipManager.bind() requires a property name to be passed as the secons parameter');
      }

      var binding = {
        obj: obj,
        property: property,
        type: type,
        id: id
      };
      bindings.push(binding);

      if (inited) {
        updateBinding(binding);
      }
    }


    function unbindAll() {
      var i = 0;
      var length = bindings.length;

      while (i < length) {
        // set bound property to undefined
        bindings[i].obj[bindings[i].property] = undefined;
        bindings[i] = undefined;
        i += 1;
      }

      bindings = [];
    }





    /**
     * @ngdoc method
     * @name Manager#unbind
     * @function
     *
     * @description
     * Unbind an entire object or a specific property
     *
     * @param {object} object - object that you will bind properties to. This will most likley be the scope or controller
     * @param {string} property - string name of property to set variable on
     */
    function unbind(obj, property) {
      var i = 0;
      var length = bindings.length;

      while (i < length) {
        if (bindings[i].obj === obj && (property === undefined || bindings[i].property === property)) {
          // set bound property to undefined
          bindings[i].obj[bindings[i].property] = undefined;
          bindings[i] = undefined;

          // remove from bindings list
          bindings.splice(i, 1);
          length -= 1;
          i -= 1;
        }
        i += 1;
      }
    }



    function updateAllBindings() {
      var i = 0;
      var length = bindings.length;

      while (i < length) {
        // remove binding if it cannot be updated
        if (updateBinding(bindings[i]) === false) {
          bindings.splice(i, 1);
          length -= 1;
          i -= 1;
        }
        i += 1;
      }
    }


    function updateBinding(binding) {
      // if the passed in object have been indefined kick back false
      if (binding.obj === undefined) { return false; }

      if (binding.type !== undefined) {
        binding.obj[binding.property] = getBindingType(binding);
      } else {
        binding.obj[binding.property] = options.data;
      }

      return true;
    }


    function getBindingType(binding) {
      var typeList = getByType(binding.type);

      if (binding.id === undefined) {
        return typeList;
      }

      return getTypeById(typeList, binding.id);
    }


    function getByType(type) {
      // if the type is the main type then return the full data
      if (type === options.typescopes[0].type) {
        return options.data;
      }

      return options.included[type];
    }


    function getTypeById(typeList, id) {
      typeList = typeList || [];

      var i = 0;
      var length = typeList.length;

      while (i < length) {
        if (typeList[i].id === id) {
          return typeList[i];
        }

        i += 1;
      }
    }






    // --- apply changes ----

    /**
     * @ngdoc method
     * @name Manager#applyChanges
     * @function
     *
     * @description
     * Submit any changed made to server
     *
     * @param {function=} callback - function to be called when changes are applied. It will pass back any errors
     */
    // will callback on complete and pass in error if one exists
    function applyChanges(callback) {
      jamBatch.add(options, function (error) {
        // TODO check to see if bindings need to be updated
        updateAllBindings();
        if (typeof callback === 'function') { callback(error); }
      });
    }



    /**
     * @ngdoc method
     * @name Manager#removeChanges
     * @function
     *
     * @description
     * remove any changes made tht have not been submitted by applyChanges
     */
    function removeChanges() {
      var patches = jamPatch.diff(options, true);
      if (patches.length > 0) {
        jamPatch.apply(options.data, patches);
        updateAllBindings();
      }
    }



    /**
     * @ngdoc method
     * @name Manager#registerScope
     * @function
     *
     * @description
     * Pass in a scope and an array of any other object you bound data to, and they will automatically be unbound when scope is destroyed
     *
     * @param {scope} scope - scope that will be watched for destroy
     * @param {array} boundObjects - pass in any other bound object(Like the controller) to unbind on scope destroy
     * @param {boolean=} removeChanges - By default when the scope is destroyed all changes not applied will get removed. Pass in false to not remove changes
     */
    function registerScope(scope, boundObjects, _removeChanges) {
      if (typeof scope !== 'object' || scope === null || scope.$watch === undefined) {
        throw Error('Must pass in a scope object');
      }

      boundObjects = boundObjects || [];

      scope.$on('$destroy', function () {
        unbind(scope);
        // call unbind indirectly so the second param of forEach does not get passed
        boundObjects.forEach(function (obj) { unbind(obj); });
        if (_removeChanges !== false) { removeChanges(); }
      });
    }




    /**
     * @ngdoc method
     * @name Manager#watch
     * @function
     *
     * @description
     * Create a watcher to have changes automatically applied. You can only have one watcher at a time
     *
     * @param {scope=} scope - pass in a scope to have watcher killed on scope destroy
     *
     * @return {function} - A function that will kill the watcher when called
     */
    function watch(scope) {
      if (options.watcher !== undefined) {
        throw Error('You can only have one watcher at a time');
      }

      if (typeof options.debounce !== 'function') {
        options.debounce = jamUtil.debounce(applyChanges, options.delay || jamKeys.DEFAULT_DEBOUNCE_TIME);
      }

      options.watcher = jamUtil.getWatcher(options);

      if (scope) {
        scope.$on('$destroy', function () {
          if (options === undefined || options.watcher === undefined) { return; }
          options.watcher();
          options.watcher = undefined;
        });
      }

      return function () {
        if (options === undefined || options.watcher === undefined) { return; }
        if (scope) { scope.$off('$destroy', options.watcher); }
        options.watcher();
        options.watcher = undefined;
      };
    }


    /**
     * @ngdoc method
     * @name Manager#destroy
     * @function
     *
     * @description
     * Kill any watcher, unbind all data, set data to undefined
     */
    function destroy() {
      if (options.watcher !== undefined) { options.watcher(); }
      unbindAll();
      options = undefined;
    }
  }
}
}());
(function(){"use strict";angular
  .module('jsonApiManager')
  .factory('jamRequest', jamRequest);


jamRequest.$inject = ['$http', 'jamUtil', 'jamJsonApi'];
function jamRequest($http, jamUtil, jamJsonApi) {
  var service = {
    baseUrl: '',
    headers: {},
    head: head,
    get: get,
    sendBatchItem: sendBatchItem
  };
  return service;



  function head(url, headers) {
    var callback = arguments[arguments.length - 1];

    if (url.indexOf('?') === -1) {
      url += '?cb=' + jamUtil.now();
    } else {
      url += '&cb=' + jamUtil.now();
    }

    request({
      method: 'HEAD',
      url: url,
      headers: headers,
      callback: typeof callback === 'function' ? callback : undefined
    });
  }

  function get(url, headers) {
    var callback = arguments[arguments.length - 1];

    request({
      method: 'GET',
      url: url,
      headers: headers,
      callback: typeof callback === 'function' ? callback : undefined
    });
  }






  // --- Send Batch items to server ----

  function sendBatchItem(item, reverse, callback) {
    var op = getOP(item.op, reverse, item.singleResource);

    request({
      method: getMethod(op),
      url: item.url,
      data: getData(item, op, reverse),
      callback: callback
    });
  }

  // reverse op if reverse true else returns op
  // this is for rolling back changes
  function getOP(op, reverse, singleResource) {
    if (reverse === true) {
      if (op === 'add' || (op === 'replace' && singleResource === true)) { return 'remove'; }
      else if (op === 'remove') { return 'add'; }
      else if (op === 'removeRelationship') { return 'relationship'; }
      else if (op === 'relationship') { return 'removeRelationship'; }
    }

    if (op === 'replace' && singleResource === true) { return 'add'; }
    return op;
  }

  // use the correct method based on the operation
  function getMethod(op) {
    if (op === 'add') { return 'PUT'; }
    if (op === 'replace') { return 'POST'; }
    if (op === 'remove' || op === 'removeRelationship') { return 'DELETE'; }
    if (op === 'relationship') { return 'POST'; }
  }

  // format and use the correct data based on the operation
  function getData(item, op, reverse) {
    var data;

    if (op === 'remove') { return undefined; }

    if (op === 'relationship' || op === 'removeRelationship') {
      if (reverse === true) {
        // nest data in array of the relationship is toMany
        data = item.toMany ? [].concat(item.oldData) : item.oldData;
        return jamJsonApi.format(data, item.type, op);
      }

      // nest data in array of the relationship is toMany
      data = item.toMany ? [].concat(item.data) : item.data;
      return jamJsonApi.format(data, item.type, op);
    }

    if (reverse === true) { return jamJsonApi.format(item.oldData, item.type, op, item.constraint, item.parentId); }
    return jamJsonApi.format(item.data, item.type, op, item.constraint, item.parentId);
  }





  function request(options) {
    var requestObj = {
      method: options.method,
      url: service.baseUrl + options.url
    };

    requestObj.headers = options.headers || {};
    angular.extend(requestObj.headers, service.headers);

    if (options.data !== undefined) {
      requestObj.data = options.data;
    }

    $http(requestObj).success(function (response, status, headers) {
      if (typeof options.callback === 'function') { options.callback(undefined, response, headers); }
    }).error(function (response, status) {
      if (typeof options.callback === 'function') { options.callback({response: response, status: status}); }
    });
  }
}
}());
(function(){"use strict";angular
  .module('jsonApiManager')
  .factory('jamUtil', jamUtil);


jamUtil.$inject = ['jamStorage', 'jamKeys', '$rootScope'];
function jamUtil(jamStorage, jamKeys, $rootScope) {
  var performance = window.performance ? angular.bind(window.performance, window.performance.now) : Date.now;
  var slice = Array.prototype.slice;

  var service = {
    now: Date.now,
    hashString: hashString,
    buildTypeScopes: buildTypeScopes,
    getCacheBustUrl: getCacheBustUrl,
    getTypeScope: getTypeScope,
    getId: getId,
    reversePatch: reversePatch,
    getPatches: getPatches,
    removeIncludes: removeIncludes,
    defaultRelationships: defaultRelationships,
    getWatcher: getWatcher,
    debounce: debounce
  };
  return service;



  // Calculate a 32 bit FNV-1a hash and convert it to hex
  function hashString(str) {
    /*jshint bitwise:false */
    var i = 0;
    var l = str.length;
    var hval = 0x811c9dc5;

    while (i < l) {
      hval ^= str.charCodeAt(i);
      hval += (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24);
      i++;
    }

    return ("0000000" + (hval >>> 0).toString(16)).substr(-8);
  }


  function getCacheBustUrl(url, cb) {
    if (url.indexOf('?') === -1) {
      return url + '?cb=' + cb;
    } else {
      return url + '&cb=' + cb;
    }
  }




  // --- Get Typescope ---

  function getTypeScope(path, type, typescopes) {
    var i = 0;
    var length = typescopes.length;
    path = getTypescopePath(path);

    // try to match path
    while (i < length) {
      if (typescopes[i].map === path) {
        // NOTE do we want to add the type check here
        return typescopes[i];
      }
      i += 1;
    }

    // if not path match then try by type
    if (type !== undefined) {
      i = 0;
      while (i < length) {
        if (typescopes[i].type === type) {
          return typescopes[i];
        }
        i += 1;
      }
    }

    return undefined;
  }
  // return path minus the array ints
  function getTypescopePath(path) {
    return path.split('/').filter(function (item) {
      return isNaN(item);
    }).join('/');
  }




  // --- Revers Patch ----
  function reversePatch(patch) {
    var reversePatch;
    var op = patch.op === 'add' ? 'remove' : patch.op === 'remove' ? 'add' : 'replace';

    if (op === 'remove') {
      reversePatch = {
        op: op,
        path: patch.path
      };

      if (patch.newItem === true && typeof patch.value === 'object' && patch.value !== null && patch.value.id) {
        reversePatch.newItem = true;
        reversePatch.value = { id: patch.value.id };
        reversePatch.type = patch.type;
      }

      return reversePatch;
    } else {
      return {
        op: op,
        path: patch.path,
        value: patch.oldData
      };
    }
  }




  // --- Generate a uuid ----
  function getId() {
    var d = Date.now();
    d += performance();

    var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = (d + Math.random()*16)%16 | 0;
        d = Math.floor(d/16);
        return (c=='x' ? r : (r&0x3|0x8)).toString(16);
    });

    return uuid;
  }



  // --- Get Patches ---
  function getPatches(id) {
    var storedItem = jamStorage.get(jamKeys.STORED_DATA_PREFIX + id) || [];

    if (storedItem.length > 0) {
      return storedItem.map(function (item) {
        return item.data;
      }).reduce(function (arr, item) {
        return arr.concat(item);
      });
    }

    return undefined;
  }



  // remove included based on patches
  function removeIncludes(reversPatches, included) {
    var patch = reversPatches.pop();

    while (patch !== undefined) {
      if (patch.op === 'remove' && patch.newItem === true) {
        removeInclude(included, patch.type, patch.value.id);
      }
      patch = reversPatches.pop();
    }
  }


  function removeInclude(included, type, id) {
    var includedByType = included[type] || [];
    var i = 0;
    var length = includedByType.length || 0;

    while (i < length) {
      if (includedByType[i].id === id) {
        includedByType.splice(i, 1);
        return;
      }
      i += 1;
    }
  }




  // --- Default relationships ---

  function defaultRelationships(obj, relationships) {
    var relationshipKeys;
    var relationshipKey;

    // default relationship object/array
    if (relationships) {
      relationshipKeys = Object.keys(relationships);
      relationshipKey = relationshipKeys.pop();

      while (relationshipKey !== undefined) {
        if (relationships[relationshipKey].toMany === true && obj[relationshipKey] === undefined) {
          obj[relationshipKey] = [];
        }
        relationshipKey = relationshipKeys.pop();
      }
    }
  }


  // --- get watcher ---
  // setup watcher and return killer
  function getWatcher(options) {
    return $rootScope.$watch(
      function () {
        return options.data;
      },
      function (newValue, oldValue) {
        // this avoids the initial fireing of the watcher
        // the undfined check will avoid the watcher being called after data is retrieved from the server
        if (newValue === oldValue || oldValue === undefined) {
          return;
        }

        options.debounce();
      }, true);
  }



  //--- debouncer ---
  function debounce(func, wait) {
    var timer;

    return function debounced () {
      var args = slice.call(arguments);

      clearTimeout(timer);
      timer = setTimeout(function () {
        timer = undefined;
        func.apply(this, args);
      }, wait);
    };
  }





  // --- Build type scopes ---

  function buildTypeScopes(options, structure) {
    var typeScopeList = [];

    var typeScope = Object.freeze({
      map: '',
      type: structure.type,
      url: options.url,
      attrs: angular.copy(structure.attributes),
      relationships: copyRelationships(structure.relationships)
    });

    typeScopeList.push(typeScope);
    parseTypescopes(structure.relationships, '', typeScope, typeScopeList);
    return typeScopeList;
  }

  function copyRelationships(relationships) {
    if (relationships === undefined) { return undefined; }

    var returnObj = {};

    Object.keys(relationships).forEach(function (key) {
      returnObj[key] = {
        type: relationships[key].type,
      };

      if (relationships[key].meta !== undefined) {
        returnObj[key].toMany = relationships[key].meta.toMany || false;
        returnObj[key].constraint = relationships[key].meta.constraint ?  relationships[key].meta.constraint.resource : undefined;
      }
    });

    return returnObj;
  }

  function parseTypescopes(structure, path, parentScope, typeScopeList) {
    if (structure === undefined) { return; }

    var typeObj;
    var typeScope;
    var relationship;
    var keys = Object.keys(structure);
    var key = keys.pop();

    while (key !== undefined) {
      relationship = structure[key];
      typeObj = {
        map: (path + '/' + key).replace(/^\//, ''),
        prop: key,
        type: relationship.type,
        url: key,
        parentScope: parentScope,
        attrs: angular.copy(relationship.attributes),
        relationships: copyRelationships(relationship.relationships)
      };

      if (relationship.meta !== undefined) {
        if (relationship.meta.toMany === true) {
          typeObj.toMany = true;
        }

        if (typeof relationship.meta.constraint === 'object' && relationship.meta.constraint !== null) {
          typeObj.constraint = relationship.meta.constraint.resource;
        }
      }

      typeScope = Object.freeze(typeObj);

      typeScopeList.push(typeScope);
      parseTypescopes(relationship.relationships, path + '/' + key, typeScope, typeScopeList);
      key = keys.pop();
    }
  }
}
}());
(function(){"use strict";angular
  .module('jsonApiManager')
  .factory('jamLZString', jamLZString);




function jamLZString () {

  var service = {
    compressToUTF16: compressToUTF16,
    decompressFromUTF16: decompressFromUTF16,
  };
  return service;



  function compressToUTF16(input) {
    if (input === null) { return ''; }

    var c;
    var length;
    var i = 0;
    var output = '';
    var current = 0;
    var status = 0;

    input = compress(input);
    length = input.length;

    while (i < length) {
      c = input.charCodeAt(i);
      i++;

      switch (status) {
        case 0:
          output += String.fromCharCode((c >> 1) + 32);
          current = (c & 1) << 14;
          status++;
          break;

        case 14:
          output += String.fromCharCode((current + (c >> 15)) + 32, (c & 32767) + 32);
          status = 0;
          break;

        default:
          output += String.fromCharCode((current + (c >> (status + 1))) + 32);
          current = (c & ((2 << status) - 1)) << (14 - status);
          status++;
          break;
      }
    }

    return output + String.fromCharCode(current + 32);
  }


  function decompressFromUTF16(input) {
    if (input === null) { return ''; }

    var c;
    var i = 0;
    var output = '';
    var current = 0;
    var length = input.length;


    while (i < length) {
      c = input.charCodeAt(i) - 32;

      if ((i & 15) !== 0) {
        output += String.fromCharCode(current | (c >> (15 - (i & 15))));
      }

      current = (c & ((1 << (15 - (i & 15))) - 1)) << ((i+1) & 15);

      i++;
    }

    return decompress(output);
  }


  function writeBit(value, data) {
    data.val = (data.val << 1) | value;

    if (data.position == 15) {
      data.position = 0;
      data.string += String.fromCharCode(data.val);
      data.val = 0;
    } else {
      data.position++;
    }
  }

  function writeBits(numBits, value, data) {
    var i = 0;
    var length = numBits;

    if (typeof(value) == "string") { value = value.charCodeAt(0); }

    while (i < length) {
      i++;

      writeBit(value & 1, data);
      value = value >> 1;
    }
  }

  function produceW(context) {
    if (context.dictionaryToCreate[context.w]) {
      if (context.w.charCodeAt(0) < 256) {
        writeBits(context.numBits, 0, context.data);
        writeBits(8, context.w, context.data);
      } else {
        writeBits(context.numBits, 1, context.data);
        writeBits(16, context.w, context.data);
      }
      decrementEnlargeIn(context);
      delete context.dictionaryToCreate[context.w];
    } else {
      writeBits(context.numBits, context.dictionary[context.w], context.data);
    }
    decrementEnlargeIn(context);
  }

  function decrementEnlargeIn(context) {
    context.enlargeIn--;

    if (context.enlargeIn === 0) {
      context.enlargeIn = Math.pow(2, context.numBits);
      context.numBits++;
    }
  }

  function compress(uncompressed) {
    if (uncompressed === null || uncompressed === undefined) {
      return '';
    }

    var context = {
      dictionary: {},
      dictionaryToCreate: {},
      c: '',
      wc: '',
      w: '',
      enlargeIn: 2, // Compensate for the first entry which should not count
      dictSize: 3,
      numBits: 2,
      result: '',
      data: {string: '', val: 0, position: 0}
    };

    var i = 0;
    var length = uncompressed.length;

    while (i < length) {
      context.c = uncompressed.charAt(i);
      i++;

      if (!context.dictionary[context.c]) {
        context.dictionary[context.c] = context.dictSize++;
        context.dictionaryToCreate[context.c] = true;
      }

      context.wc = context.w + context.c;
      if (context.dictionary[context.wc]) {
        context.w = context.wc;
      } else {
        produceW(context);
        // Add wc to the dictionary.
        context.dictionary[context.wc] = context.dictSize++;
        context.w = String(context.c);
      }
    }

    // Output the code for w.
    if (context.w !== '') {
      produceW(context);
    }

    // Mark the end of the stream
    writeBits(context.numBits, 2, context.data);

    // Flush the last char
    while (true) {
      context.data.val = (context.data.val << 1);
      if (context.data.position == 15) {
        context.data.string += String.fromCharCode(context.data.val);
        break;
      }
      else context.data.position++;
    }

    return context.data.string;
  }

  function readBit(data) {
    var res = data.val & data.position;
    data.position >>= 1;
    if (data.position === 0) {
      data.position = 32768;
      data.val = data.string.charCodeAt(data.index++);
    }
    return res > 0 ? 1 : 0;
  }

  function readBits(numBits, data) {
    var res = 0;
    var maxpower = Math.pow(2, numBits);
    var power = 1;
    while (power != maxpower) {
      res |= readBit(data) * power;
      power <<= 1;
    }
    return res;
  }

  function decompress(compressed) {
    if (compressed === '') {
      return null;
    }

    if (compressed === null || compressed === undefined) {
      return '';
    }

    var next;
    var result;
    var w;
    var c;
    var i = 0;
    var dictionary = {};
    var enlargeIn = 4;
    var dictSize = 4;
    var numBits = 3;
    var entry = '';
    var errorCount = 0;
    var data = {string: compressed, val: compressed.charCodeAt(0), position: 32768, index: 1};

    while (i < 3) {
      dictionary[i] = i;
      i++;
    }

    next = readBits(2, data);
    switch (next) {
      case 0:
        c = String.fromCharCode(readBits(8, data));
        break;
      case 1:
        c = String.fromCharCode(readBits(16, data));
        break;
      case 2:
        return '';
    }

    dictionary[3] = c;
    w = result = c;
    while (true) {
      c = readBits(numBits, data);

      switch (c) {
        case 0:
          if (errorCount++ > 10000) return "Error";
          c = String.fromCharCode(readBits(8, data));
          dictionary[dictSize++] = c;
          c = dictSize - 1;
          enlargeIn--;
          break;
        case 1:
          c = String.fromCharCode(readBits(16, data));
          dictionary[dictSize++] = c;
          c = dictSize - 1;
          enlargeIn--;
          break;
        case 2:
          return result;
      }

      if (enlargeIn === 0) {
        enlargeIn = Math.pow(2, numBits);
        numBits++;
      }

      if (dictionary[c]) {
        entry = dictionary[c];
      } else {
        if (c === dictSize) {
          entry = w + w.charAt(0);
        } else {
          return null;
        }
      }
      result += entry;

      // Add w+entry[0] to the dictionary.
      dictionary[dictSize++] = w + entry.charAt(0);
      enlargeIn--;

      w = entry;

      if (enlargeIn === 0) {
        enlargeIn = Math.pow(2, numBits);
        numBits++;
      }
    }
  }

}
}());
(function(){"use strict";angular
  .module('jsonApiManager')
  .service('jamStorage', jamStorage);



jamStorage.$inject = ['$window', 'jamLZString'];
function jamStorage($window, jamLZString) {
  // these are used to parse the dates with the reviever function
  var ISO_REG = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d*))(?:Z|(\+|-)([\d|:]*))?$/;
  var MS_AJAX_REG = /^\/Date\((d|-|.*)\)[\/|\\]$/;

  var now = Date.now; // returns the milliseconds elapsed since 1 January 1970 00:00:00 UTC
  var memoryStorage = {};
  var storage = $window.localStorage;
  var isStorageAvailable = testStorage();

  var service = {
    set: set,
    get: get,
    remove: remove
  };
  return service;



  // test if local storage exists
  function testStorage() {
    if (storage === undefined) { return false; }

    try {
      storage.setItem('_jamTest_', 0);
      storage.removeItem('_jamTest_');
      return true;
    } catch (e) {
      return false;
    }
  }


  function set(key, value) {
    memoryStorage[key] = angular.copy(value);

    // store item if enabled
    if (isStorageAvailable === false) { return true; }
    value = jamLZString.compressToUTF16(JSON.stringify(value));

    // store value
    storage.setItem(key, value);

    return true;
  }


  function get(key) {
    var item;

    // gdt from memory
    if (memoryStorage[key] === undefined) {
      if (isStorageAvailable === false) { return undefined; }
      item = storage.getItem(key);
      if (item === null) { return undefined; }

      memoryStorage[key] = JSON.parse(jamLZString.decompressFromUTF16(item), dateParse);
    }

    return angular.copy(memoryStorage[key]);
  }


  function remove(key) {
    memoryStorage[key] = undefined;
    if (isStorageAvailable === true) { storage.removeItem(key); }

    return true;
  }




  // reviver for json parse
  // this function converts dates an sparse arrays
  function dateParse(key, value) {
    var a;
    var b;

    // parse dates
    if (typeof value === 'string') {

      // attemp to parse iso
      a = ISO_REG.exec(value);
      if (a !== null) {
        return new Date(value);
      }

      // attemp to parse ms ajax
      a = MS_AJAX_REG.exec(value);
      if (a !== null) {
        b = a[1].split(/[-+,.]/);
        return new Date(b[0] ? +b[0] : 0 - +b[1]);
      }
    }

    return value;
  }

}
}());