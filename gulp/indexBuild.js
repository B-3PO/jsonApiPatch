var paths = require('./config').paths;

var gulp = require('gulp');
var inject = require('gulp-inject');


exports.inject = function () {
  var moduleScripts = gulp.src(paths.moduleScripts, {read: false});
  var moduleCss = gulp.src(paths.moduleCss, {read: false});
  var appScripts = gulp.src(paths.scripts, {read: false});
  var appCss = gulp.src(paths.css, {read: false});

  return gulp.src(paths.app + 'index.html')
    .pipe(inject(appCss, {
      relative: true,
      ignorePath: '../'
    }))
    .pipe(inject(appScripts, {
      name: 'appscripts',
      relative: true,
      ignorePath: '../'
    }))
    .pipe(inject(moduleCss, {
      name: 'moduleCss',
      relative: true,
      ignorePath: '../'
    }))
    .pipe(inject(moduleScripts, {
      name: 'moduleScripts',
      relative: true,
      ignorePath: '../'
    }))
    .pipe(gulp.dest(paths.dest));
};
