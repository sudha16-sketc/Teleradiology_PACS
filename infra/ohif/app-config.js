window.config = {
  routerBasename: '/ohif',

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
        qidoRoot: 'http://localhost:3000/api/dicom-web',
        wadoRoot: 'http://localhost:3000/api/dicom-web',
        wadoUriRoot: 'http://localhost:3000/api/dicom-web/wado',

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