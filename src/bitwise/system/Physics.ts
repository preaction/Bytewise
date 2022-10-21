
import * as bitecs from 'bitecs';
import Ammo from 'ammo.js';
import System from '../System.js';
import Scene from '../Scene.js';
import Position from '../component/Position.js';
import RigidBody from '../component/RigidBody.js';
import BoxCollider from '../component/BoxCollider.js';

type ColliderMap = {
  box?: BoxCollider,
};
type ColliderQueryMap = {
  [key in keyof ColliderMap]: bitecs.Query;
};
const COLLIDER_SHAPES = {
  box: Ammo.btBoxShape,
};

export default class Physics extends System {
  rigidbody:RigidBody;
  position:Position;
  collider:ColliderMap = {};

  universe:any;
  bodies:Array<any> = [];

  colliderQueries:ColliderQueryMap = {};
  rigidbodyQuery:bitecs.Query;
  enterQueries:ColliderQueryMap = {};
  exitQueries:ColliderQueryMap = {};

  constructor( name:string, scene:Scene, data:any ) {
    super( name, scene, data );

    this.position = scene.getComponent(Position);
    this.rigidbody = scene.getComponent(RigidBody);

    this.collider = {
      box: scene.getComponent(BoxCollider),
    };

    for ( const [name, collider] of Object.entries(this.collider) ) {
      const query = scene.game.ecs.defineQuery([ this.position.store, collider.store ]);
      this.colliderQueries[name as keyof ColliderMap] = query;
      this.enterQueries[name as keyof ColliderMap] = scene.game.ecs.enterQuery( query );
      this.exitQueries[name as keyof ColliderMap] = scene.game.ecs.exitQuery( query );
    }
    this.rigidbodyQuery = scene.game.ecs.defineQuery([ this.position.store, this.rigidbody.store ]);

    this.initAmmo();
  }

  initAmmo() {
    const collisionConfiguration = new Ammo.btDefaultCollisionConfiguration();
    const dispatcher = new Ammo.btCollisionDispatcher(collisionConfiguration);
    const overlappingPairCache = new Ammo.btDbvtBroadphase();
    const solver = new Ammo.btSequentialImpulseConstraintSolver();
    this.universe = new Ammo.btDiscreteDynamicsWorld(dispatcher, overlappingPairCache, solver, collisionConfiguration);
    // XXX: Gravity should be configuration
    this.universe.setGravity(new Ammo.btVector3(0, 0, 0));
  }

  update( timeMilli:number ) {
    const position = this.position.store;
    const rigidBody = this.rigidbody.store;

    // Create any new colliders
    for ( const [colliderName, query] of Object.entries(this.enterQueries) ) {
      const add = query(this.scene.world);
      for ( const eid of add ) {
        const component = this.collider[colliderName as keyof ColliderMap]?.store;
        if ( !component ) {
          throw `Unknown collider ${colliderName}`;
        }

        let transform = new Ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin( new Ammo.btVector3( position.x[eid], position.y[eid], position.z[eid] ) );
        console.log( `${eid}: Initial position: ${position.x[eid]}, ${position.y[eid]}, ${position.z[eid]}` );

        transform.setRotation( new Ammo.btQuaternion( position.rx[eid], position.ry[eid], position.rz[eid], position.rw[eid] ) );
        let motionState = new Ammo.btDefaultMotionState( transform );

        // Scale should be adjusted by object scale
        console.log( `${eid}: Collider ${colliderName} scale: ${component.sx[eid] * position.sx[eid]}, ${component.sy[eid] * position.sy[eid]}, ${component.sz[eid] * position.sz[eid]}` );
        const scale = new Ammo.btVector3(component.sx[eid] * position.sx[eid] / 2, component.sy[eid] * position.sy[eid] / 2, component.sz[eid] * position.sz[eid] / 2);
        const collider = new COLLIDER_SHAPES[colliderName as keyof ColliderMap](scale);
        collider.setMargin( 0 );
        const origin = new Ammo.btVector3( component.ox[eid], component.oy[eid], component.oz[eid] );
        transform.setOrigin( transform.getOrigin() + origin );

        // If the item has a rigidbody, it can have mass
        let body;
        if ( this.scene.game.ecs.hasComponent( this.scene.world, this.rigidbody.store, eid ) ) {
          // Calculate mass and initial inertia for dynamic bodies. Static
          // bodies have a mass of 0. Kinematic bodies collide but are not
          // affected by dynamic bodies.
          const mass = rigidBody.mass[eid];
          let inertia = new Ammo.btVector3( 0, 0, 0 );

          if ( mass > 0 ) {
            console.log( `${eid}: RigidBody Mass: ${mass}, Velocity: ${rigidBody.vx[eid]}, ${rigidBody.vy[eid]}, ${rigidBody.vz[eid]}` );
            inertia = new Ammo.btVector3( rigidBody.vx[eid], rigidBody.vy[eid], rigidBody.vz[eid] );
            collider.calculateLocalInertia( mass, inertia );
          }
          // XXX: Is Kinematic?

          let rbodyInfo = new Ammo.btRigidBodyConstructionInfo( mass, motionState, collider, inertia );
          body = new Ammo.btRigidBody( rbodyInfo );
          // XXX: Only allow x and y movement, and z rotation
          // XXX: This should be a rigidbody component configuration
          body.setLinearFactor( new Ammo.btVector3(1,1,0) );
          body.setAngularFactor( new Ammo.btVector3(0,0,1) );
          this.universe.addRigidBody( body );
        }
        else {
          // Create a ghost body for this collider
          body = new Ammo.btGhostObject();
          body.setCollisionShape(collider);
        }

        this.bodies[eid] = body;
      }
    }

    for ( const [colliderName, query] of Object.entries(this.exitQueries) ) {
      const remove = query(this.scene.world);
      for ( const eid of remove ) {
        // XXX: Remove body and collider
      }
    }

    this.universe.stepSimulation( timeMilli, 10 );
    for ( const [colliderName, query] of Object.entries(this.colliderQueries) ) {
      const update = query(this.scene.world);
      for ( const eid of update ) {
        const xform = new Ammo.btTransform();
        let motionState = this.bodies[eid].getMotionState();
        if ( motionState ) {
          motionState.getWorldTransform( xform );
          let pos = xform.getOrigin();
          position.x[eid] = pos.x();
          position.y[eid] = pos.y();
          position.z[eid] = pos.z();

          let rot = xform.getRotation();
          position.rx[eid] = rot.x();
          position.ry[eid] = rot.y();
          position.rz[eid] = rot.z();
          position.rw[eid] = rot.w();

          // XXX: Detect collisions and do something with them

        }
      }
    }
  }
}
