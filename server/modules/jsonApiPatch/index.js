var mysql = require('mysql');
var connection = mysql.createConnection({
  host: '127.0.0.1',
  user: 'tester',
  password: 'testTester',
  database: 'jsonapipatch'
});



// --- Public -----------
// ----------------------


function patch(data, callback) {
  var idsByType = getIdsByType(data);
  getPatches(idsByType, function (patchByType) {
    applyPatches(data, patchByType);
    callback(data);
  });
}







// --- Private -----------
// -----------------------



// --- apply patches ---

function applyPatches(data, patches) {
  Object.keys(patches).forEach(function (type) {
    patches[type].forEach(function (patch) {
      var item = getItem(data, type, patch.id);
      if (item === undefined) { return; }

      patchOps[patch.op](item, patch)
    });
  });
}


var patchOps = {
  replace: replace,
  add: add,
  remove: remove
};

function replace(value, patch) {
  value.attributes[patch.prop] = patch.value;
}


function add(value, patch) {

}


function remove(value, patch) {
  var i;
  var length;
  var relationship = value.relationships ? value.relationships[patch.prop] : undefined;
  if (relationship === undefined) { return; }

  if (relationship.data instanceof Array) {
    i = 0;
    length = relationship.data.length;
    while (i < length) {
      if (relationship.data[i].id === patch.value) {
        relationship.data.splice(i, 1);
        return;
      }
      i += 1;
    }
  } else if (relationship.data !== null && relationship.data.id === patch.value) {
    relationship.data = null;
  }
}

function remove_old(value, patch) {
  var i;
  var length;
  var item = value[patch.prop];

  if (item === undefined || item === null) { return; }
  if (item instanceof Array) {

    i = 0;
    length = item.length;
    while (i < length) {
      if (item[i].id === patch.value) {
        item.splice(i, 1);
        break;
      }
      i += 1;
    }

  } else if (item.id === patch.value) {
    delete value[patch.prop];
  }
}


function getItem(data, type, id) {
  var i;
  var length;

  // check in data
  if (data.data instanceof Array) {
    i = 0;
    length = data.data.length;

    while (i < length) {
      if (data.data[i].type === type && data.data[i].id === id) {
        return data.data[i];
      }
      i += 1;
    }
  } else if (data !== null && data.type === type && data.id === id) {
    return data.data;
  }

  // check in includes
  if (data.included !== undefined) {
    i = 0;
    length = data.included.length;

    while (i < length) {
      if (data.included[i].type === type && data.included[i].id === id) {
        return data.included[i];
      }
      i += 1;
    }
  }

  return undefined;
}




// --- Get patches ----

function getPatches(idsByType, callback) {
  var query = 'select value,type from patches\n';
  query += 'where ' + getWheres(idsByType) + '\n';
  query += 'order by created_at'

  connection.query(query, function(error, rows, fields) {
    callback(groupByType(rows));
  });
}

function getWheres(idsByType) {
  return Object.keys(idsByType).map(function (typeKey) {
    return '(type=\'' + typeKey + '\' and resource in (' + idsByType[typeKey].join(',') + '))';
  }).join(' or ');
}

function groupByType(rows) {
  var byType = {};
  var row = rows.pop();

  while (row !== undefined) {
    if (byType[row.type] === undefined) {
      byType[row.type] = [];
    }

    byType[row.type] = byType[row.type].concat(JSON.parse(row.value));
    row = rows.pop();
  }
  return byType;
}

function getIdsByType(data) {
  var byType = {};

  [].concat(data.data).forEach(function (item) {
    if (byType[item.type] === undefined) {
      byType[item.type] = [];
    }

    if (byType[item.type].indexOf(item.data_id) === -1) {
      byType[item.type].push(item.data_id);
    }
  });


  if (data.included !== undefined) {
    data.included.forEach(function (item) {
      if (byType[item.type] === undefined) {
        byType[item.type] = [];
      }

      if (byType[item.type].indexOf(item.data_id) === -1) {
        byType[item.type].push(item.data_id);
      }
    });
  }

  return byType;
}




module.exports = {
  patch: patch
};
