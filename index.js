const process = require('process');
const axios = require('axios');
const core = require('@actions/core');
const fs = require('fs');
const exec = require('./exec');

/**
 * Builds the new readme by replacing the readme's <!-- BLOG-POST-LIST:START --><!-- BLOG-POST-LIST:END --> tags
 * @param previousContent {string}: actual readme content
 * @param newContent {string}: content to add
 * @return {string}: content after combining previousContent and newContent
 */
const buildReadme = (previousContent, newContent) => {
  const tagToLookFor = `<!-- insta-feed:`;
  const closingTag = '-->';
  const startOfOpeningTagIndex = previousContent.indexOf(
    `${tagToLookFor}START`,
  );
  const endOfOpeningTagIndex = previousContent.indexOf(
    closingTag,
    startOfOpeningTagIndex,
  );
  const startOfClosingTagIndex = previousContent.indexOf(
    `${tagToLookFor}END`,
    endOfOpeningTagIndex,
  );
  if (
    startOfOpeningTagIndex === -1 ||
    endOfOpeningTagIndex === -1 ||
    startOfClosingTagIndex === -1
  ) {
    // Exit with error if comment is not found on the readme
    core.error(
      `Cannot find the comment tag on the readme:\n<!-- ${tagToLookFor}:START -->\n<!-- ${tagToLookFor}:END -->`
    );
    process.exit(1);
  }
  return [
    previousContent.slice(0, endOfOpeningTagIndex + closingTag.length),
    '\n',
    newContent,
    '\n',
    previousContent.slice(startOfClosingTagIndex),
  ].join('');
};

/**
 * Code to do git commit
 * @return {Promise<void>}
 */
const commitReadme = async () => {
  // Getting config
  const committerUsername = 'Ravi Rupareliya';
  const committerEmail = 'rupareliyaravi@gmail.com';
  const commitMessage = 'Instagram feed updated.';
  // Doing commit and push
  await exec('git', [
    'config',
    '--global',
    'user.email',
    committerEmail,
  ]);
  // if (GITHUB_TOKEN) {
  //   // git remote set-url origin
  //   await exec('git', ['remote', 'set-url', 'origin',
  //     `https://${GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPOSITORY}.git`]);
  // }
  await exec('git', ['config', '--global', 'user.name', committerUsername]);
  await exec('git', ['add', README_FILE_PATH]);
  await exec('git', ['commit', '-m', commitMessage]);
  await exec('git', ['push']);
  core.info("Readme updated successfully.");
  // Making job fail if one of the source fails
  process.exit(jobFailFlag ? 1 : 0);
};

// Total no of posts to display on readme, all sources combined, default: 5
const TOTAL_POST_COUNT = 12;
// Readme path, default: ./README.md
const README_FILE_PATH = './README.md';
// const GITHUB_TOKEN = core.getInput('gh_token');

// core.setSecret(GITHUB_TOKEN);

const promiseArray = []; // Runner
const runnerNameArray = []; // To show the error/success message
let postsArray = []; // Array to store posts
let jobFailFlag = false; // Job status flag

// Reading feed list from the workflow input
let feedList = ['https://www.instagram.com/ravi.rupareliya/?__a=1'];

feedList.forEach((siteUrl) => {
  runnerNameArray.push(siteUrl);
  promiseArray.push(new Promise((resolve, reject) => {
    axios.get(siteUrl)
      .then(response => {
        console.log(response.data);
        const responsePosts = response.data.graphql.user.edge_owner_to_timeline_media.edges;
        const posts = responsePosts
          .map((item) => {
            return {
              url: item.node.thumbnail_resources[3].src
            };
          });
        resolve(posts);
      })
      .catch(error => {
        reject(error);
      });

    // parser.parseURL(siteUrl).then((data) => {
    //   if (!data.items) {
    //     reject("Cannot read response->item");
    //   } else {
    //     const responsePosts = data.items;
    //     const posts = responsePosts
    //       .map((item) => {
    //         // Validating keys to avoid errors
    //         if (!item.pubDate) {
    //           reject("Cannot read response->item->pubDate");
    //         }
    //         if (!item.title) {
    //           reject("Cannot read response->item->title");
    //         }
    //         if (!item.link) {
    //           reject("Cannot read response->item->link");
    //         }
    //         return {
    //           title: item.title,
    //           url: item.link,
    //           date: new Date(item.pubDate)
    //         };
    //       });
    //     resolve(posts);
    //   }
    // }).catch(reject);
  }));
});

// Processing the generated promises
Promise.allSettled(promiseArray).then((results) => {
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      // Succeeded
      core.info(runnerNameArray[index] + ' runner succeeded. Post count: ' + result.value.length);
      postsArray.push(...result.value);
    } else {
      jobFailFlag = true;
      // Rejected
      core.error(runnerNameArray[index] + ' runner failed, please verify the configuration. Error:');
      core.error(result.reason);
    }
  });
}).finally(() => {
  // Slicing with the max count
  postsArray = postsArray.slice(0, TOTAL_POST_COUNT);
  if (postsArray.length > 0) {
    try {
      const readmeData = fs.readFileSync(README_FILE_PATH, "utf8");
      const postListMarkdown = postsArray.reduce((acc, cur, index) => {
        // Default template: - [$title]($url)
        let startTag = '', endTag = ''
        if (index === 0 || index === 3 || index === 6 || index === 9) {
          startTag = '<p align=\"center\">'
        }
        if (index === 2 || index === 5 || index === 8 || index === 11) {
          endTag = '</p>'
        }

        return acc + startTag + `<img align="center" src=${cur.url} />` + endTag;
      }, '');
      const newReadme = buildReadme(readmeData, postListMarkdown);
      // if there's change in readme file update it
      if (newReadme !== readmeData) {
        core.info('Writing to ' + README_FILE_PATH);
        fs.writeFileSync(README_FILE_PATH, newReadme);
        if (!process.env.TEST_MODE) {
          // noinspection JSIgnoredPromiseFromCall
          commitReadme();
        }
      } else {
        core.info('No change detected, skipping');
        process.exit(0);
      }
    } catch (e) {
      core.error(e);
      process.exit(1);
    }
  } else {
    core.info("0 blog posts fetched");
    process.exit(jobFailFlag ? 1 : 0);
  }
});