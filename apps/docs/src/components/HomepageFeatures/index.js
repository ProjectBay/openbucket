import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

const FeatureList = [
  {
    title: 'S3 wire-compatible',
    Svg: require('@site/static/img/undraw_device-sync_d9ei.svg').default,
    description: (
      <>
        SigV4 auth, presigned URLs, multipart uploads, versioning, object lock,
        SSE-S3 encryption, lifecycle, CORS, and bucket policies. Point any AWS S3
        SDK at it.
      </>
    ),
  },
  {
    title: 'Batteries-included admin',
    Svg: require('@site/static/img/undraw_electricity_iu6d.svg').default,
    description: (
      <>
        A JSON admin API secured with argon2id + rotating JWTs, plus an Angular
        console: bucket &amp; object browser, presigned share links, access-key
        management, and per-bucket editors.
      </>
    ),
  },
  {
    title: 'Container or library',
    Svg: require('@site/static/img/undraw_choice_dzxz.svg').default,
    description: (
      <>
        Run the small Docker image standalone, or <code>npm install</code>{' '}
        <code>@openbucket/nestjs</code> and mount a full object store under a
        path prefix inside your own NestJS app.
      </>
    ),
  },
];

function Feature({Svg, title, description}) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center">
        <Svg className={styles.featureSvg} role="img" />
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
