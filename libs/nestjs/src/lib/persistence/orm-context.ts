/**
 * MikroORM `contextName` for OpenBucket's own ORM instance.
 *
 * Naming the context isolates OpenBucket's MikroORM — and its `MikroORM`,
 * `EntityManager`, and repository DI tokens — from a HOST application that also
 * uses MikroORM under the (unnamed) default context. Without this, the default
 * `MikroORM`/`EntityManager` provider tokens would collide. See the packaging
 * plan, phase 5.
 *
 * Every `forFeature` / `getRepositoryToken` / `InjectMikroORM` /
 * `InjectEntityManager` call in the library is scoped to this name. A host must
 * not register its own MikroORM context with this same name.
 */
export const OPEN_BUCKET_ORM_CONTEXT = 'openbucket';
