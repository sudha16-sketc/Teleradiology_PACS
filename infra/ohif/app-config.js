const dicomWebRoot = `${window.location.origin}/api/dicom-web`;

window.config = {
  routerBasename: '/ohif',

  // These arrays must exist (even if empty) so that the viewer's
  // extension/mode machinery can safely iterate over them. Without them,
  // OHIF throws "appConfig.extensions is not iterable".
  extensions: [],
  modes: [],

  showStudyList: true,

  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'orthanc',

      configuration: {
        friendlyName: 'Axis Orthanc',
        name: 'Orthanc',

        // All DICOMweb traffic flows through the Axis API proxy so that the
        // existing session cookie and RBAC guards protect study access.
        qidoRoot: dicomWebRoot,
        wadoRoot: dicomWebRoot,
        wadoUriRoot: `${dicomWebRoot}/wado`,

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