/**
 * The app store holds on to user preferences and remembers where the
 * user's projects are.
 */

import * as Vue from 'vue';
import { defineStore, acceptHMRUpdate } from 'pinia';
import { loadModule } from 'vue3-sfc-loader';
import type { Game, Component, System } from '@fourstar/bitwise';
import type { DirectoryItem } from '../Backend.js';

// Core Component Forms
import TransformEdit from '../components/bitwise/Transform.vue';
import OrthographicCameraEdit from '../components/bitwise/OrthographicCamera.vue';
import SpriteEdit from '../components/bitwise/Sprite.vue';
import RigidBodyEdit from '../components/bitwise/RigidBody.vue';
import BoxColliderEdit from '../components/bitwise/BoxCollider.vue';
import UIElementEdit from '../components/bitwise/UIElement.vue';
import UIImageEdit from '../components/bitwise/UIImage.vue';
import UITextEdit from '../components/bitwise/UIText.vue';
import UIButtonEdit from '../components/bitwise/UIButton.vue';
import UIContainerEdit from '../components/bitwise/UIContainer.vue';

// Core System forms
import PhysicsEdit from '../components/bitwise/system/Physics.vue';

type Tab = {
  data: any,
  edited: boolean,
  src: string,
  icon: string,
  ext: string,
  component: string,
  name: string,
}

const templates:{ [key:string]: (name:string) => string } = {
  'Component.ts': (name:string):string => {
    return `
import * as bitecs from 'bitecs';
import { Component } from '@fourstar/bitwise';

export default class ${name} extends Component {
  get componentData() {
    return {
      // fieldName: bitecs.Types.f32
    };
  }

  declare store: {
    // fieldName: number[],
  }

  static get editorComponent():string {
    // Path to the .vue component, if any
    return '';
  }
}
`;
  },
  'System.ts': (name:string):string => {
    return `
import * as three from 'three';
import * as bitecs from 'bitecs';
import { Scene, System } from '@fourstar/bitwise';

export default class ${name} extends System {
  init() {
    // Get references to Components and Systems from this.scene
    // Create queries with bitecs.Query
    // Add event handlers
  }

  update( timeMilli:number ) {
    // Perform updates
  }

  static get editorComponent():string {
    // Path to the .vue component, if any
    return '';
  }
}
`;
  },
  'Component.vue': (name:string):string => {
    return `<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  props: ['modelValue', 'scene'],
  data() {
    return {
      ...this.modelValue,
    };
  },
  methods: {
    update() {
      this.$emit( 'update:modelValue', this.$data );
      this.$emit( 'update', this.$data );
    },
  },
});
</script>
<template>
  <div>
  </div>
</template>
<style>
</style>
`;
  },
};

const vueLoaderOptions = {
  moduleCache: {
    vue: Vue,
  },
  async getFile(url:string) {
    const res = await fetch(url);
    if ( !res.ok ) {
      throw Object.assign(new Error(res.statusText + ' ' + url), { res });
    }
    return {
      getContentData: (asBinary:boolean) => asBinary ? res.arrayBuffer() : res.text(),
    }
  },
  addStyle(textContent:string) {
    const style = Object.assign(document.createElement('style'), { textContent });
    const ref = document.head.getElementsByTagName('style')[0] || null;
    document.head.insertBefore(style, ref);
  },
};

type AppState = {
  isBuilding: boolean,
  currentProject: null|string,
  recentProjects: string[],
  openTabs: Tab[],
  currentTabIndex: number,
  projectItems: DirectoryItem[],
  icons: { [key:string]: string },
  dragtypes: { [key:string]: string },
  gameFile: string,
  gameClass: null|typeof Game,
  gameConfig: any,
  components: { [key:string]: typeof Component },
  systems: { [key:string]: typeof System },
  componentForms: { [key:string]: any },
  systemForms: { [key:string]: any },
  buildTimeout: any,
  _fsWatcher: any,
  _pendingChanges: Array<{eventType: string, filename: string}>,
};

export const useAppStore = defineStore('app', {
  state: () => {
    return {
      currentProject: null,
      recentProjects: electron.store.get( 'app', 'recentProjects', [] ),
      openTabs: [
      ],
      currentTabIndex: 0,
      projectItems: [],
      icons: {
        SceneEdit: 'fa-film',
        TilesetEdit: 'fa-grid-2-plus',
        PrefabEdit: 'fa-cubes',
      },
      dragtypes: {
        SceneEdit: 'scene',
        TilesetEdit: 'tileset',
        PrefabEdit: 'prefab',
      },
      isBuilding: false,
      _fsWatcher: null,
      gameFile: '',
      gameClass: null,
      gameConfig: {},
      components: Vue.markRaw({}),
      systems: Vue.markRaw({}),
      componentForms: Vue.markRaw({
        "Transform": TransformEdit,
        "OrthographicCamera": OrthographicCameraEdit,
        "Sprite": SpriteEdit,
        "RigidBody": RigidBodyEdit,
        "BoxCollider": BoxColliderEdit,
        "UIElement": UIElementEdit,
        "UIImage": UIImageEdit,
        "UIText": UITextEdit,
        "UIButton": UIButtonEdit,
        "UIContainer": UIContainerEdit,
      }),
      systemForms: Vue.markRaw({
        "Physics": PhysicsEdit,
      }),
      buildTimeout: null,
      _pendingChanges: [],
    } as AppState;
  },

  getters: {
    hasStoredState():boolean {
      return !!electron.store.get( 'app', 'savedState', false );
    },
    storedStateProject() {
      const path = electron.store.get( 'app', 'savedState.currentProject', '' );
      return path.split('/').pop();
    },
  },

  actions: {

    async openProject( path:string='' ) {
      if ( this._fsWatcher ) {
        electron.removeListener( 'watch', this._fsWatcher );
      }
      if ( !path ) {
        const res = await electron.openProject();
        path = res.filePaths[0];
      }
      this.currentProject = path;

      // this.saveSessionState();
      // this.saveStoredState();

      // Load up project files
      await this.readProject();
      await this.buildProject();

      this._fsWatcher = this.changeFile.bind(this);
      electron.on( 'watch', this._fsWatcher );
    },

    changeFile(event:any, changes:{eventType:string, filename:string}[]) {
      // If we do not have focus, queue up changes to process
      if ( !document.hasFocus() ) {
        if ( !this._pendingChanges?.length ) {
          const processChanges = () => {
            this.processChanges( this._pendingChanges );
            this._pendingChanges = [];
            window.removeEventListener( 'focus', processChanges );
          };
          window.addEventListener( 'focus', processChanges );
        }
        this.isBuilding = true;
        this._pendingChanges.push( ...changes );
        return;
      }
      this.processChanges( changes );
    },

    processChanges( changes:{eventType:string, filename:string}[] ) {
      this.readProject();
      // If any ts/js file changed, build the project
      if ( changes.find( ({eventType, filename}) => !filename.match(/(^|\/)\./) && filename.match( /\.[tj]s$/ ) ) ) {
        this.isBuilding = true;
        if ( this.buildTimeout ) {
          clearTimeout( this.buildTimeout );
        }
        this.buildTimeout = setTimeout( () => { this.buildProject(); this.buildTimeout = null }, 1000 );
      }
    },

    async readProject() {
      if ( !this.currentProject ) {
        return;
      }

      try {
        const fileContent = await this.readFile('bitwise.json');
        this.gameConfig = JSON.parse( fileContent );
      }
      catch (err) {
        console.warn( `Error opening bitwise.json: ${err}` );
      }

      // XXX: Map component to icon class
      this.projectItems = await electron.readProject(this.currentProject);
    },

    async buildProject() {
      if ( !this.currentProject ) {
        return;
      }
      this.isBuilding = true;
      const gameFile = await electron.buildProject( this.currentProject );
      if ( !gameFile ) {
        throw 'Error building project';
      }

      try {
        const mod = await import( /* @vite-ignore */ gameFile );
        if ( this.gameFile ) {
          electron.deleteTree( this.currentProject, this.gameFile );
        }
        this.gameFile = gameFile;
        this.gameClass = mod.default;
      }
      catch (e) {
        console.error( `Could not load game class: ${e}` );
      }

      if ( this.gameClass ) {
        try {
          const game = new this.gameClass({});
          this.components = game.components;
          this.systems = game.systems;
        }
        catch (e) {
          console.log( `Could not create new game: ${e}` );
        }

        for ( const name in this.components ) {
          const component = this.components[name];
          if ( component.editorComponent ) {
            const path = this.currentProject + '/' + component.editorComponent;
            console.log( `Loading editor component for component ${name}: ${path}` );
            this.componentForms[name] = await loadModule( `bfile://${path}`, vueLoaderOptions );
          }
        }

        for ( const name in this.systems ) {
          const system = this.systems[name];
          if ( system.editorComponent ) {
            const path = this.currentProject + '/' + system.editorComponent;
            console.log( `Loading editor component for system ${name}: ${path}` );
            this.systemForms[name] = await loadModule( `bfile://${path}`, vueLoaderOptions );
          }
        }
      }

      this.isBuilding = false;
    },

    saveProject() {
    },

    async newProject() {
      const res = await electron.newProject();
      this.openProject(res.filePath);
    },

    async releaseProject( type:string ):Promise<any> {
      if ( !this.currentProject ) {
        return;
      }
      return electron.releaseProject( this.currentProject, type );
    },

    getFileUrl( path:string ):string {
      if ( !this.currentProject ) {
        throw "No current project";
      }
      return 'bfile://' + this.currentProject + '/' + Vue.toRaw(path);
    },

    readFile( path:string ) {
      if ( !this.currentProject ) {
        throw "No current project";
      }
      return electron.readFile( this.currentProject, path );
    },

    saveFile( path:string, data:Object ) {
      if ( !this.currentProject ) {
        throw "No current project";
      }
      return electron.saveFile( this.currentProject, path, data )
        .then( res => {
          // XXX: Oh, this is just absolutely wrong: We're not always
          // saving only the current tab when we run saveFile()
          const tab = this.openTabs[ this.currentTabIndex ];
          tab.edited = false;

          // this.saveSessionState();
          // this.saveStoredState();
        } );
    },

    newFile( name:string, ext:string, data:Object ) {
      if ( !this.currentProject ) {
        throw "No current project";
      }
      const project = this.currentProject;
      return electron.newFile( this.currentProject, name, ext )
        .then( async ( res ) => {
          if ( !res.canceled ) {
            const name = res.filePath.split('/').pop() as string;
            await this.saveFile( name, data );
            const tab = this.openTabs[ this.currentTabIndex ];
            tab.name = name;
            tab.src = res.filePath.replace( project, '' );
            tab.edited = false;

            // this.saveSessionState();
            // this.saveStoredState();
          }
        });
    },

    async newModuleFromTemplate( name:string, templateName:string ) {
      if ( !this.currentProject ) {
        throw "No current project";
      }
      const ext = templateName.substring( templateName.lastIndexOf( '.' )+1 );
      const project = this.currentProject;
      return electron.newFile( this.currentProject, name, ext )
        .then( async res => {
          if ( !res.canceled ) {
            const path = res.filePath.replace( project, '' );
            const fileName = path.split('/').pop();
            if ( !fileName ) {
              return;
            }
            const name = fileName.substring( 0, fileName.indexOf('.') );
            const template = templates[ templateName ](name);
            await electron.saveFile( project, path, template );
            this.openEditor(path);
          }
        });
    },

    openEditor( path:string ) {
      if ( !this.currentProject ) {
        throw "No current project";
      }
      return electron.openEditor( this.currentProject, path );
    },

    deleteTree( path:string ) {
      if ( !this.currentProject ) {
        throw "No current project";
      }
      // Pre-delete item from projectItems
      const pathParts = path.split( '/' );
      let items = this.projectItems;
      for ( let depth = 0; depth < pathParts.length; depth++ ) {
        const findPath = pathParts.slice(0, depth+1).join('/');
        const i = items.findIndex( (item:DirectoryItem) => item.path === findPath );
        if ( depth == pathParts.length ) {
          items.splice( i, 1 );
          break;
        }
        items = items[i].children ?? [];
      }
      return electron.deleteTree( this.currentProject, path );
    },

    renamePath( path:string, dest:string ) {
      if ( !this.currentProject ) {
        throw "No current project";
      }
      // XXX: Pre-move item in projectItems
      return electron.renamePath( this.currentProject, path, dest );
    },

    importFiles() {
      if ( !this.currentProject ) {
        return [];
      }
      return electron.importFiles( this.currentProject );
    },
  },
});

// XXX: This doesn't work with our current Jest setup, and we're going
// to get rid of Pinia anyway since it's not really necessary if editors
// access the electron object directly...
// if (import.meta?.hot) {
//   import.meta.hot.accept(acceptHMRUpdate(useAppStore, import.meta.hot))
// }
