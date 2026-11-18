// In production the viewer is delivered through the Axis frontend's /ohif
// rewrite, so the browser origin is also the first-party /api origin carrying
// the Axis session cookie. Preserve the local API target when browsing the
// container directly; authenticated DICOM access still requires the /ohif
// frontend rewrite.
const apiOrigin =
  window.location.hostname === 'localhost' &&
  window.location.port === '3001'
    ? 'http://localhost:3000'
    : window.location.origin;
const dicomWebRoot = `${apiOrigin}/api/dicom-web`;

window.config = {
  routerBasename: '/ohif',

  // These arrays must exist (even if empty) so that the viewer's
  // extension/mode machinery can safely iterate over them. Without them,
  // OHIF throws "appConfig.extensions is not iterable".
  extensions: [],
  modes: [],

  // No `oidc` block by design. Authentication is owned by the main Axis API;
  // adding an OIDC provider here would create a second, independent login.
  // The study list is disabled so imaging is always entered from the
  // authorized Axis Reading Page.
  showStudyList: false,

  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'orthanc',

      configuration: {
        friendlyName: 'Axis Orthanc',
        name: 'Orthanc',

        // All DICOMweb traffic flows through the same-origin Axis API proxy so
        // the existing session cookie and RBAC guards protect study access.
        qidoRoot: dicomWebRoot,
        wadoRoot: dicomWebRoot,

        qidoSupportsIncludeField: true,

        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',

        enableStudyLazyLoad: true,

        supportsFuzzyMatching: true,
        supportsWildcard: true,

        dicomUploadEnabled: false
      }
    }
  ],

  defaultDataSourceName: 'orthanc'
};