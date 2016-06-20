var jsonApiPatch = require('../jsonApiPatch');
var manager;

function initTypes(dataManager) {
  dataManager.addType({
    name: 'menus',
    table: 'menus',
    attributes: {
      name: {dataType: dataManager.dataType.STRING},
      type: {dataType: dataManager.dataType.STRING}
    }
  });
}


function initManager(dataManager) {
  manager = dataManager.CreateResource({
    name: 'menus',
    type: 'menus',
    relationships: {
      categories: {
        resource: 'categories',
        oneToMany: true
      }
    }
  });
}

function addRoutes(app) {
  app.use('/menus', manager);
}


function initIntercepters() {
  manager.interceptGetResponse(function (req, res, data, next) {
    jsonApiPatch.patch(data, function (data) {
      res.send(data);
    });
  }, true);
}


module.exports = function(app, dataManager) {
	initTypes(dataManager);

	return {
    initRoutes: initRoutes
  };

  function initRoutes() {
    initManager(dataManager);
    initIntercepters();
    addRoutes(app);
  }
};
