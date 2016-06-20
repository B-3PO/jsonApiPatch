function initTypes(dataManager) {
  dataManager.addType({
    name: 'categories',
    table: 'categories',
    constraint: true,
    attributes: {
      name: {dataType: dataManager.dataType.STRING},
      type: {dataType: dataManager.dataType.STRING}
    }
  });
}



function addRoutes(app, dataManager) {
  app.use('/categories', dataManager.CreateResource({
    name: 'categories',
    type: 'categories',
    relationships: {
      menuItems: {
        resource: 'menuItems',
        oneToMany: true
      }
    }
  }));
}


module.exports = function(app, dataManager) {
	initTypes(dataManager);

	return {
    initRoutes: initRoutes
  };

  function initRoutes() {
    addRoutes(app, dataManager);
  }
};
