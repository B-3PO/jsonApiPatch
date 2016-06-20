angular
  .module('jsonApiPatch')
  .controller('HomeController', HomeController);


HomeController.$inject = ['jsonApiManager'];
function HomeController(jsonApiManager) {
  var vm = this;

  var menusManager = jsonApiManager.create({
    url: 'menus',
    include: ['categories.menuItems']
  }, function (error) {
    console.log(error);
  });


  menusManager.bind(vm, 'menus');
  menusManager.get(function () {
    console.log(vm.menus);
  })

}
