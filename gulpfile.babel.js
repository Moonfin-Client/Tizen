import gulp from 'gulp';
import { deleteAsync as del } from 'del';
import { readFileSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

console.info('Building Moonfin Tizen app');

// Read version from package.json
const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
const version = pkg.version;

// Clean the build directory
function clean() {
    return del(['build/**', '!build']);
}

// Copy all app files to build directory
function copyFiles() {
    return gulp.src([
        '*.html',
        '*.xml',
        'shaka-player.js',  // Only include specific JS files, not gulpfile
        'css/**/*',
        'js/**/*',
        'assets/**/*',
        'components/**/*'
    ], { base: '.', encoding: false })
    .pipe(gulp.dest('build/'));
}

// Package the build into a versioned .wgt file
async function packageWgt() {
    const versionedWgtName = `Moonfin-${version}.wgt`;
    const wgtName = 'Moonfin.wgt';
    await del([versionedWgtName, wgtName]);
    
    // Copy signature files to build directory if they exist
    try {
        await execAsync('cp -f .sign/author-signature.xml .sign/signature1.xml build/ 2>/dev/null || true');
        console.info('Added signature files to build directory');
    } catch (e) {
        console.warn('Warning: No signature files found - package may not install on device');
    }
    
    // Create both versioned and non-versioned packages
    console.info(`Creating ${wgtName}...`);
    await execAsync(`cd build && zip -r ../${wgtName} . -x "*.git*" -x "gulpfile.babel.js"`);
    console.info(`Package created: ${wgtName}`);
    
    console.info(`Creating ${versionedWgtName}...`);
    await execAsync(`cd build && zip -r ../${versionedWgtName} . -x "*.git*" -x "gulpfile.babel.js"`);
    console.info(`Package created: ${versionedWgtName}`);
}

// Default build task
const build = gulp.series(clean, copyFiles);

// Build and package task
const buildPackage = gulp.series(clean, copyFiles, packageWgt);

export { clean, copyFiles, packageWgt, buildPackage };
export default build;
