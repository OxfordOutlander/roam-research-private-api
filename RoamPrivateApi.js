const puppeteer = require( 'puppeteer' );
const fs = require( 'fs' );
const os = require( 'os' );
const unzip = require( 'node-unzip-2' );
const { isString } = require( 'util' );
const moment = require( 'moment' );
class RoamPrivateApi {
	options;
	browser;
	page;
	db;
	login;
	pass;

	constructor( db, login, pass, options = { headless: true, folder: null, nodownload: false } ) {
		this.db = db;
		this.login = login;
		this.pass = pass;
		this.options = options;
		// If you dont pass folder option, we will use the system tmp directory.
		if ( ! options.folder ) {
			options.folder = os.tmpdir();
		}
	}

	async runQuery( query ) {
		return await this.page.evaluate( ( query ) => {
			if ( ! window.roamAlphaAPI ) {
				return Promise.reject( 'No Roam API detected' );
			}
			const result = window.roamAlphaAPI.q( query );
			console.log( result );
			return Promise.resolve( result );
		}, query );
	}

	async deleteBlocksMatchingQuery( query, limit ) {
		if ( ! limit ) {
			limit = 1;
		}
		return await this.page.evaluate( ( query, limit ) => {
			if ( ! window.roamAlphaAPI ) {
				return Promise.reject( 'No Roam API detected' );
			}
			const result = window.roamAlphaAPI.q( query );
			console.log( result );
			if ( result.length > 100 ) {
				return Promise.reject( 'Too many results. Is your query ok?' );

			}
			const limited = result.slice( 0, limit );
			limited.forEach( ( block ) => {
				const id = block[0];
				console.log( 'DELETING', id );
				window.roamAlphaAPI.deleteBlock( { block: { uid: id } } );
			} );
			return Promise.resolve( limited );
		}, query, limit );
	}
	
	getQueryToFindBlocksOnPage( text, pageTitle ) {
		text = text.replace( '"', '\"' );
		pageTitle = pageTitle.replace( '"', '\"' );

		return `[:find ?uid
			:where [?b :block/string "${text}"]
				   [?b :block/uid  ?uid]
				   [?b :block/page ?p]
				   [?p :node/title "${pageTitle}"]]`;
	}

	getQueryToFindBlocks( text ) {
		text = text.replace( '"', '\"' );
		return `[:find ?uid ?string ?title :where
			[?b :block/string ?string]
			[(clojure.string/includes? ?string "${text}")]
			[?b :block/uid  ?uid]
			[?b :block/page ?p]
			[?p :node/title ?title]
		]`;
	}

	async removeImportBlockFromDailyNote() {
		await this.deleteBlocksMatchingQuery(
			this.getQueryToFindBlocksOnPage(
				'Import',
				this.dailyNoteTitle()
			),
			1
		);
		await this.page.waitForTimeout( 1000 );
		return;
	}

	dailyNoteTitle() {
		return moment( new Date() ).format( 'MMMM Do, YYYY' );
	}

	async getExportData() {
		// Mostly for testing purposes when we want to use a preexisting download.
		if ( ! this.options.nodownload ) {
			await this.logIn();
			await this.downloadExport( this.options.folder );
		}
		const latestExport = this.getLatestFile( this.options.folder );
		const content = await this.getContentsOfRepo( this.options.folder, latestExport );
		await this.close();
		return content;
	}
	/**
	 * Logs in to Roam interface.
	 */
	async logIn() {
		if ( this.browser ) {
			return this.browser;
		}
		this.browser = await puppeteer.launch( this.options );
		try {
			this.page = await this.browser.newPage();
			this.page.setDefaultTimeout( 60000 );
			await this.page.goto( 'https://roamresearch.com/#/app/' + this.db );
			await this.page.waitForNavigation();
			await this.page.waitForSelector( 'input[name=email]' );
		} catch ( e ) {
			console.error( 'Cannot load the login screen!' );
			throw e;
		}
		// Login
		await this.page.type( 'input[name=email]', this.login );
		await this.page.type( 'input[name=password]', this.pass );
		await this.page.click( '.bp3-button' );
		await this.page.waitForSelector( '.bp3-icon-more' );
		return;
	}

	async import( items = [] ) {
		const fileName = this.options.folder + 'roam-research-private-api-sync.json';
		fs.writeFileSync( fileName, JSON.stringify( items ) );
		await this.logIn();
		await this.page.waitForSelector( '.bp3-icon-more' );
		await this.clickMenuItem( 'Import Files' );
		// await this.page.click( '.bp3-icon-more' );
		// // This should contain "Export All"
		// await this.page.waitFor( 2000 );
		// await this.page.click( '.bp3-menu :nth-child(5) a' );
		await this.page.waitForSelector( 'input[type=file]' );
		await this.page.waitForTimeout( 1000 );
		// get the ElementHandle of the selector above
		const inputUploadHandle = await this.page.$( 'input[type=file]' );

		// Sets the value of the file input to fileToUpload
		inputUploadHandle.uploadFile( fileName );
		await this.page.waitForSelector( '.bp3-dialog .bp3-intent-primary' );
		await this.page.click( '.bp3-dialog .bp3-intent-primary' );
		await this.page.waitForTimeout( 3000 );
		await this.removeImportBlockFromDailyNote();
		return;
	}

	async quickCapture( text = [] ) {
		await this.logIn();
		const page = await this.browser.newPage();
		await page.emulate( puppeteer.devices[ 'iPhone X' ] );
		// set user agent (override the default headless User Agent)
		await page.goto( 'https://roamresearch.com/#/app/' + this.db );

		await page.waitForSelector( '#block-input-quick-capture-window-qcapture' );
		if ( isString( text ) ) {
			text = [ text ];
		}

		text.forEach( async function ( t ) {
			await page.type( '#block-input-quick-capture-window-qcapture', t );
			await page.click( 'button.bp3-intent-primary' );
		} );
		await page.waitForTimeout( 500 );
		// page.close();
		await this.close();
		return;
	}
	async clickMenuItem( title ) {
		await this.page.click( '.bp3-icon-more' );
		// This should contain "Export All"
		await this.page.waitForTimeout( 1000 );
		await this.page.evaluate( ( title ) => {
			const items = [ ...document.querySelectorAll( '.bp3-menu li a' ) ];
			items.forEach( ( item ) => {
				console.log( item.innerText, title );
				if ( item.innerText === title ) {
					item.click();
					return;
				}
			} );
		}, title );
	}
	async downloadExport( folder ) {
		await this.page._client.send( 'Page.setDownloadBehavior', {
			behavior: 'allow',
			downloadPath: folder,
		} );
		// Try to download
		// await this.page.goto( 'https://roamresearch.com/#/app/' + this.db );
		// await this.page.waitForNavigation();
		await this.page.waitForSelector( '.bp3-icon-more' );
		await this.clickMenuItem( 'Export All' );
		// await this.page.click( '.bp3-icon-more' );
		// // This should contain "Export All"
		// await this.page.waitFor( 2000 );
		// await this.page.click( '.bp3-menu :nth-child(4) a' );
		//Change markdown to JSON:
		// This should contain markdown
		await this.page.waitForTimeout( 2000 );
		await this.page.click( '.bp3-dialog-container .bp3-popover-wrapper button' );
		// This should contain JSON
		await this.page.waitForTimeout( 2000 );
		await this.page.click( '.bp3-dialog-container .bp3-popover-wrapper .bp3-popover-dismiss' );
		// This should contain "Export All"
		await this.page.waitForTimeout( 2000 );
		await this.page.click( '.bp3-dialog-container .bp3-intent-primary' );

		await this.page.waitForTimeout( 60000 ); // This can take quite some time on slower systems
		// Network idle is a hack to wait until we donwloaded stuff. I don't think it works though.
		await this.page.goto( 'https://news.ycombinator.com/', { waitUntil: 'networkidle2' } );
		return;
	}
	async close() {
		if ( this.browser ) {
			await this.page.waitForTimeout( 1000 );
			await this.browser.close();
			this.browser = null;
		}
		return;
	}

	getLatestFile( dir ) {
		const orderReccentFiles = ( dir ) =>
			fs
				.readdirSync( dir )
				.filter( ( f ) => fs.lstatSync( dir + f ) && fs.lstatSync( dir + f ).isFile() )
				.filter( ( f ) => f.indexOf( 'Roam-Export' ) !== -1 )
				.map( ( file ) => ( { file, mtime: fs.lstatSync( dir + file ).mtime } ) )
				.sort( ( a, b ) => b.mtime.getTime() - a.mtime.getTime() );

		const getMostRecentFile = ( dir ) => {
			const files = orderReccentFiles( dir );
			return files.length ? files[ 0 ] : undefined;
		};
		return dir + getMostRecentFile( dir ).file;
	}

	getContentsOfRepo( dir, file ) {
		return new Promise( ( resolve, reject ) => {
			const stream = fs.createReadStream( file ).pipe( unzip.Parse() );
			stream.on( 'entry', function ( entry ) {
				var fileName = entry.path;
				var type = entry.type; // 'Directory' or 'File'
				var size = entry.size;
				if ( fileName.indexOf( '.json' ) != -1 ) {
					entry.pipe( fs.createWriteStream( dir + 'db.json' ) );
				} else {
					entry.autodrain();
				}
			} );
			// Timeouts are here so that the system locks can be removed - takes time on some systems.
			stream.on( 'close', function () {
				setTimeout( function() {
					fs.readFile( dir + 'db.json', 'utf8', function ( err, data ) {
						if ( err ) {
							reject( err );
						} else {
							resolve( JSON.parse( data ) );	
						}
					} );
				}, 1000 );
			} );
		} );
	}
}

module.exports = RoamPrivateApi;
